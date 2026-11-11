// In-memory fakes of the Apps Script services the CCCP server bundle touches. One file serves
// two hosts: the browser dev harness (dev/serve.mjs) and the node test environment
// (test/gasEnv.ts evaluates it with `window` aliased to `globalThis`).
//
// Derived from sidekick gas_hub/dev/gas-shims.js and gas/dev/gas-shims.js at commit 77bcf22
// (see VENDOR.md). Added for CCCP: a read-only SpreadsheetApp fake over a loadable workbook,
// Sheets and Drive advanced-service fakes that record their calls, a fake clock, TTL-aware
// CacheService, a LockService with timeouts, real gzip under node, formatDate with a zone.
//
// THE SOURCE FAKE IS READ-ONLY. Every mutator on Spreadsheet, Sheet and Range throws
// 'CCCP must never write to the source sheet'. UserProperties and the per-user caches are
// refused too: under USER_DEPLOYING they would be the deployer's store.

(function () {
  "use strict";

  var G = typeof window !== "undefined" ? window : globalThis;
  var WRITE_ERROR = "CCCP must never write to the source sheet";
  var OWNER = "owner@example.com";

  // ------------------------------------------------------------------ state and clock
  var clockOffset = 0;
  function now() { return Date.now() + clockOffset; }

  var counters = { propGet: 0, propSet: 0, cacheGet: 0, cachePut: 0, cacheHit: 0, sheetRead: 0, lockWait: 0 };
  var propGetKeys = Object.create(null);
  var props = new Map();
  var cache = new Map(); // key -> {v, exp}
  var calls = [];
  var exportsById = new Map();
  var workbooks = new Map();
  var sourceAccess = true;
  var cacheDisabled = false;
  var activeUser = OWNER;
  var effectiveUser = OWNER;
  var sheetTz = "Europe/Paris";
  var lockHeldElsewhere = false;
  var lockHeldByUs = false;
  var htmlFiles = new Map();
  var seq = 0;

  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  function record(svc, args) { calls.push({ svc: svc, args: clone(args) }); }

  // ------------------------------------------------------------------------ Blob
  function FakeBlob(data, contentType, name) {
    this._data = data; // string or signed byte array
    this._type = contentType || null;
    this._name = name || null;
  }
  FakeBlob.prototype.getDataAsString = function () {
    if (typeof this._data === "string") return this._data;
    return new TextDecoder().decode(Uint8Array.from(this._data, function (b) { return b & 0xff; }));
  };
  FakeBlob.prototype.getBytes = function () {
    return typeof this._data === "string" ? toSigned(new TextEncoder().encode(this._data)) : this._data.slice();
  };
  FakeBlob.prototype.getName = function () { return this._name; };
  FakeBlob.prototype.setName = function (n) { this._name = n; return this; };
  FakeBlob.prototype.getContentType = function () { return this._type; };

  function toSigned(u8) {
    var out = new Array(u8.length);
    for (var i = 0; i < u8.length; i++) out[i] = u8[i] > 127 ? u8[i] - 256 : u8[i];
    return out;
  }
  function toU8(bytes) { return Uint8Array.from(bytes, function (b) { return b & 0xff; }); }
  function bytesToBinary(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, Array.from(bytes.slice(i, i + 0x8000), function (b) { return b & 0xff; }));
    }
    return s;
  }
  function nodeZlib() {
    try {
      return typeof process !== "undefined" && process.getBuiltinModule ? process.getBuiltinModule("zlib") : null;
    } catch (e) { return null; }
  }

  // -------------------------------------------------------------------- Utilities
  var PARTS_FMT = {};
  function zoneParts(ms, tz) {
    var f = PARTS_FMT[tz];
    if (!f) {
      f = PARTS_FMT[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
      });
    }
    var o = {};
    f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }
  function offsetMinutes(ms, tz) {
    var p = zoneParts(ms, tz);
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  }
  /** Date.formatDate semantics for the tokens CCCP uses, in an IANA zone. */
  function formatDate(date, tz, fmt) {
    var ms = date instanceof Date ? date.getTime() : +date;
    if (isNaN(ms)) throw new Error("Invalid date");
    var p = zoneParts(ms, tz);
    var off = offsetMinutes(ms, tz);
    var sign = off < 0 ? "-" : "+";
    var ao = Math.abs(off);
    var hh = pad(Math.floor(ao / 60), 2), mm = pad(ao % 60, 2);
    var msPart = pad(((ms % 1000) + 1000) % 1000, 3);
    return String(fmt).replace(/'([^']*)'|yyyy|yy|MM|M|dd|d|HH|H|mm|ss|SSS|EEE|XXX|ZZZ|Z/g, function (t, lit) {
      if (lit !== undefined) return lit === "" ? "'" : lit;
      switch (t) {
        case "yyyy": return p.year;
        case "yy": return p.year.slice(2);
        case "MM": return p.month;
        case "M": return String(+p.month);
        case "dd": return p.day;
        case "d": return String(+p.day);
        case "HH": return p.hour;
        case "H": return String(+p.hour);
        case "mm": return p.minute;
        case "ss": return p.second;
        case "SSS": return msPart;
        case "EEE": return p.weekday;
        case "XXX": return off === 0 ? "Z" : sign + hh + ":" + mm;
        default: return sign + hh + mm; // Z, ZZZ
      }
    });
  }
  /** Midnight of a wall-clock date in a zone, as epoch ms. */
  function zonedMidnight(y, m, d, tz) {
    var guess = Date.UTC(y, m - 1, d);
    var off = offsetMinutes(guess, tz);
    var t = guess - off * 60000;
    var off2 = offsetMinutes(t, tz);
    return off2 === off ? t : guess - off2 * 60000;
  }

  var Utilities = {
    newBlob: function (data, contentType, name) { return new FakeBlob(data, contentType, name); },
    gzip: function (blob, name) {
      var z = nodeZlib();
      var bytes = blob.getBytes();
      // Real gzip under node, so sizes behave like production. The browser page has no
      // synchronous gzip, so there it is an identity transform tagged as gzip.
      var out = z ? toSigned(z.gzipSync(Buffer.from(toU8(bytes)))) : bytes;
      return new FakeBlob(out, "application/x-gzip", name || blob.getName());
    },
    ungzip: function (blob) {
      var z = nodeZlib();
      var bytes = blob.getBytes();
      var isGz = bytes.length > 2 && (bytes[0] & 0xff) === 0x1f && (bytes[1] & 0xff) === 0x8b;
      var out = z && isGz ? toSigned(z.gunzipSync(Buffer.from(toU8(bytes)))) : bytes;
      return new FakeBlob(out, "application/octet-stream", blob.getName());
    },
    base64Encode: function (input) {
      var u8 = typeof input === "string" ? new TextEncoder().encode(input) : toU8(input);
      return btoa(bytesToBinary(u8));
    },
    base64Decode: function (s) { return toSigned(Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); })); },
    sleep: function (ms) { clockOffset += Math.max(0, +ms || 0); },
    getUuid: function () {
      if (G.crypto && G.crypto.randomUUID) return G.crypto.randomUUID();
      return "00000000-0000-4000-8000-" + pad((++seq).toString(16), 12);
    },
    formatDate: formatDate,
  };
  G.Utilities = Utilities;

  // ------------------------------------------------------------ PropertiesService
  var PROP_VALUE_MAX = 9 * 1024;
  function byteLen(s) { return new TextEncoder().encode(String(s)).length; }
  var scriptProps = {
    getProperty: function (k) {
      counters.propGet++;
      propGetKeys[k] = (propGetKeys[k] || 0) + 1;
      return props.has(k) ? props.get(k) : null;
    },
    setProperty: function (k, v) {
      if (byteLen(v) > PROP_VALUE_MAX) throw new Error("Argument too large: value");
      counters.propSet++;
      props.set(k, String(v));
      return scriptProps;
    },
    setProperties: function (o, deleteAll) {
      if (deleteAll) props.clear();
      Object.keys(o).forEach(function (k) { scriptProps.setProperty(k, o[k]); });
      return scriptProps;
    },
    deleteProperty: function (k) { props.delete(k); return scriptProps; },
    deleteAllProperties: function () { props.clear(); return scriptProps; },
    getProperties: function () { return Object.fromEntries(props); },
    getKeys: function () { return Array.from(props.keys()); },
  };
  G.PropertiesService = {
    getScriptProperties: function () { return scriptProps; },
    getUserProperties: function () { throw new Error("CCCP must not use UserProperties"); },
    getDocumentProperties: function () { throw new Error("CCCP must not use DocumentProperties"); },
  };

  // --------------------------------------------------------------------- Session
  G.Session = {
    getActiveUser: function () { return { getEmail: function () { return activeUser; } }; },
    getEffectiveUser: function () { return { getEmail: function () { return effectiveUser; } }; },
    getScriptTimeZone: function () { return "Etc/GMT"; },
  };

  // ------------------------------------------------------------------- ScriptApp
  var SERVICE_URL = ["https:", "", "script.google.com", "macros", "s", "DEV_CCCP_DEPLOYMENT", "exec"].join("/");
  G.ScriptApp = {
    getService: function () { return { getUrl: function () { return SERVICE_URL; } }; },
    getScriptId: function () { return "DEV_CCCP_SCRIPT"; },
  };

  // ----------------------------------------------------------------- LockService
  // tryLock(ms) returns false and waitLock(ms) throws when another "execution" holds the
  // lock (set with __gasFakes.holdLock(true)). Nothing really waits: the fake clock jumps.
  var lock = {
    tryLock: function (ms) {
      if (lockHeldElsewhere) { counters.lockWait++; clockOffset += +ms || 0; return false; }
      lockHeldByUs = true;
      return true;
    },
    waitLock: function (ms) {
      if (!lock.tryLock(ms)) throw new Error("Lock timeout: Could not obtain lock after " + (+ms || 0) + " milliseconds.");
    },
    releaseLock: function () { lockHeldByUs = false; },
    hasLock: function () { return lockHeldByUs; },
  };
  G.LockService = {
    getScriptLock: function () { return lock; },
    getUserLock: function () { throw new Error("CCCP must not use the user lock"); },
    getDocumentLock: function () { throw new Error("CCCP must not use the document lock"); },
  };

  // ---------------------------------------------------------------- CacheService
  // Script-global only. Values are strings, at most 100 KB; keys at most 250 chars; the TTL
  // defaults to 600 s and is capped at 21600 s, as in production.
  var CACHE_VALUE_MAX = 100 * 1024;
  function cacheLive(k) {
    var e = cache.get(k);
    if (!e) return null;
    if (e.exp <= now()) { cache.delete(k); return null; }
    return e;
  }
  function cachePut(k, v, ttl) {
    if (String(k).length > 250) throw new Error("Argument too large: key");
    if (byteLen(v) > CACHE_VALUE_MAX) throw new Error("Argument too large: value");
    counters.cachePut++;
    if (cacheDisabled) return;
    var sec = Math.min(ttl == null ? 600 : +ttl, 21600);
    cache.set(String(k), { v: String(v), exp: now() + sec * 1000 });
  }
  var scriptCache = {
    get: function (k) {
      counters.cacheGet++;
      var e = cacheLive(k);
      if (e) counters.cacheHit++;
      return e ? e.v : null;
    },
    getAll: function (keys) {
      var out = {};
      keys.forEach(function (k) { var v = scriptCache.get(k); if (v != null) out[k] = v; });
      return out;
    },
    put: function (k, v, ttl) { cachePut(k, v, ttl); },
    putAll: function (o, ttl) { Object.keys(o).forEach(function (k) { cachePut(k, o[k], ttl); }); },
    remove: function (k) { cache.delete(k); },
    removeAll: function (keys) { keys.forEach(function (k) { cache.delete(k); }); },
  };
  G.CacheService = {
    getScriptCache: function () { return scriptCache; },
    getUserCache: function () { throw new Error("CCCP must not use the user cache"); },
    getDocumentCache: function () { throw new Error("CCCP must not use the document cache"); },
  };

  // ----------------------------------------------------------------- HtmlService
  function evaluateScriptlets(src, vars) {
    return src.replace(/<\?!=\s*([\s\S]*?)\s*\?>/g, function (_m, expr) {
      var inc = /^include\(\s*(['"])(.*?)\1\s*\);?$/.exec(expr);
      if (inc) return readHtmlFile(inc[2]);
      var key = expr.replace(/;$/, "");
      var v = vars[key];
      return v == null ? "" : String(v);
    });
  }
  function readHtmlFile(name) {
    if (htmlFiles.has(name)) return htmlFiles.get(name);
    if (typeof XMLHttpRequest !== "undefined") {
      // Browser harness: partials come from dev/serve.mjs. Synchronous, like GAS.
      var req = new XMLHttpRequest();
      req.open("GET", "/_partial/" + name, false);
      req.send(null);
      if (req.status === 200) return req.responseText;
    }
    throw new Error("No HTML file named " + name + " was found.");
  }
  function makeOutput(content) {
    var out = {
      _title: "", _meta: {}, _xfo: null,
      getContent: function () { return content; },
      setTitle: function (t) { out._title = String(t); return out; },
      getTitle: function () { return out._title; },
      addMetaTag: function (n, c) { out._meta[n] = c; return out; },
      setXFrameOptionsMode: function (m) { out._xfo = m; return out; },
      setContent: function (c) { content = String(c); return out; },
    };
    return out;
  }
  G.HtmlService = {
    XFrameOptionsMode: { ALLOWALL: "ALLOWALL", DEFAULT: "DEFAULT" },
    createHtmlOutput: function (s) { return makeOutput(String(s == null ? "" : s)); },
    createHtmlOutputFromFile: function (name) { return makeOutput(readHtmlFile(name)); },
    createTemplateFromFile: function (name) {
      var tpl = { evaluate: function () { return makeOutput(evaluateScriptlets(readHtmlFile(name), tpl)); } };
      return tpl;
    },
  };

  // ---------------------------------------------------------- SpreadsheetApp (read-only)
  function cellToValue(cell, tz) {
    if (cell == null) return "";
    if (typeof cell === "object" && typeof cell.$wall === "string") {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cell.$wall);
      return new Date(zonedMidnight(+m[1], +m[2], +m[3], tz));
    }
    return cell;
  }
  function displayOf(v, tz) {
    if (v instanceof Date) return formatDate(v, tz, "yyyy-MM-dd");
    if (v === true) return "TRUE";
    if (v === false) return "FALSE";
    return v === "" || v == null ? "" : String(v);
  }
  var MUTATORS = {
    Spreadsheet: ["rename", "setName", "insertSheet", "deleteSheet", "duplicateSheet", "setActiveSheet", "moveActiveSheet",
      "addEditor", "addEditors", "addViewer", "addViewers", "removeEditor", "removeViewer", "setSpreadsheetTimeZone",
      "setSpreadsheetLocale", "setFrozenRows", "setFrozenColumns", "copy", "deleteActiveSheet", "toast", "setNamedRange",
      "appendRow", "setActiveRange", "setRecalculationInterval"],
    Sheet: ["setName", "appendRow", "clear", "clearContents", "clearFormats", "clearNotes", "insertRows", "insertRowsAfter",
      "insertRowsBefore", "insertRowBefore", "insertRowAfter", "insertColumns", "insertColumnAfter", "insertColumnBefore",
      "deleteRow", "deleteRows", "deleteColumn", "deleteColumns", "setFrozenRows", "setFrozenColumns", "setColumnWidth",
      "setRowHeight", "hideSheet", "showSheet", "sort", "protect", "setTabColor", "activate", "copyTo", "autoResizeColumn",
      "setHiddenGridlines", "setValue", "setValues", "setConditionalFormatRules", "removeDuplicates", "setActiveSelection"],
    Range: ["setValue", "setValues", "setFormula", "setFormulas", "setNote", "setNotes", "clear", "clearContent",
      "clearContents", "clearFormat", "clearNote", "setBackground", "setBackgrounds", "setFontColor", "setFontWeight",
      "setFontWeights", "setNumberFormat", "setNumberFormats", "setHorizontalAlignment", "setWrap", "merge", "mergeAcross",
      "mergeVertically", "breakApart", "sort", "insertCheckboxes", "setDataValidation", "copyTo", "moveTo", "trimWhitespace",
      "removeDuplicates", "activate", "protect", "setFontFamily", "setFontSize", "setBorder", "randomize", "check", "uncheck"],
  };
  function refuse() { throw new Error(WRITE_ERROR); }
  function installMutators(proto, names) { names.forEach(function (n) { proto[n] = refuse; }); }

  function FakeRange(sheet, r0, c0, nr, nc) { this._s = sheet; this._r = r0; this._c = c0; this._nr = nr; this._nc = nc; }
  FakeRange.prototype._grid = function (display) {
    counters.sheetRead++;
    var tz = this._s._book.tz;
    var out = [];
    for (var i = 0; i < this._nr; i++) {
      var row = [];
      for (var j = 0; j < this._nc; j++) {
        var src = this._s._rows[this._r + i];
        var raw = src ? src[this._c + j] : "";
        var v = cellToValue(raw, tz);
        row.push(display ? displayOf(v, tz) : v);
      }
      out.push(row);
    }
    return out;
  };
  FakeRange.prototype.getValues = function () { return this._grid(false); };
  FakeRange.prototype.getDisplayValues = function () { return this._grid(true); };
  FakeRange.prototype.getValue = function () { return this._grid(false)[0][0]; };
  FakeRange.prototype.getDisplayValue = function () { return this._grid(true)[0][0]; };
  FakeRange.prototype.getNumRows = function () { return this._nr; };
  FakeRange.prototype.getNumColumns = function () { return this._nc; };
  FakeRange.prototype.getRow = function () { return this._r + 1; };
  FakeRange.prototype.getColumn = function () { return this._c + 1; };
  FakeRange.prototype.getSheet = function () { return this._s; };
  installMutators(FakeRange.prototype, MUTATORS.Range);

  function FakeSheet(book, tab) {
    this._book = book;
    this._name = tab.name;
    this._gid = tab.gid;
    var w = 0;
    tab.rows.forEach(function (r) { if (r.length > w) w = r.length; });
    this._w = w;
    this._rows = tab.rows.map(function (r) { var c = r.slice(); while (c.length < w) c.push(""); return c; });
  }
  FakeSheet.prototype.getName = function () { return this._name; };
  FakeSheet.prototype.getSheetId = function () { return this._gid; };
  FakeSheet.prototype.getIndex = function () { return this._book._sheets.indexOf(this) + 1; };
  FakeSheet.prototype.getParent = function () { return this._book; };
  FakeSheet.prototype.getLastRow = function () { return this._rows.length; };
  FakeSheet.prototype.getLastColumn = function () { return this._w; };
  FakeSheet.prototype.getMaxRows = function () { return Math.max(this._rows.length, 1000); };
  FakeSheet.prototype.getMaxColumns = function () { return Math.max(this._w, 26); };
  FakeSheet.prototype.getDataRange = function () { return new FakeRange(this, 0, 0, this._rows.length, this._w); };
  FakeSheet.prototype.getRange = function (r, c, nr, nc) {
    return new FakeRange(this, r - 1, c - 1, nr == null ? 1 : nr, nc == null ? 1 : nc);
  };
  FakeSheet.prototype.isSheetHidden = function () { return false; };
  installMutators(FakeSheet.prototype, MUTATORS.Sheet);

  function FakeSpreadsheet(wb) {
    this._id = wb.id;
    this._name = wb.name;
    this.tz = wb.tz || sheetTz;
    this._sheets = [];
    var self = this;
    wb.tabs.forEach(function (t) { self._sheets.push(new FakeSheet(self, t)); });
  }
  FakeSpreadsheet.prototype.getId = function () { return this._id; };
  FakeSpreadsheet.prototype.getName = function () { return this._name; };
  FakeSpreadsheet.prototype.getUrl = function () { return ["https:", "", "docs.google.com", "spreadsheets", "d", this._id, "edit"].join("/"); };
  FakeSpreadsheet.prototype.getSpreadsheetTimeZone = function () { return this.tz; };
  FakeSpreadsheet.prototype.getSheets = function () { return this._sheets.slice(); };
  FakeSpreadsheet.prototype.getSheetByName = function (n) {
    for (var i = 0; i < this._sheets.length; i++) if (this._sheets[i]._name === n) return this._sheets[i];
    return null;
  };
  FakeSpreadsheet.prototype.getSheetById = function (gid) {
    for (var i = 0; i < this._sheets.length; i++) if (this._sheets[i]._gid === gid) return this._sheets[i];
    return null;
  };
  installMutators(FakeSpreadsheet.prototype, MUTATORS.Spreadsheet);

  function openBook(id) {
    var wb = sourceAccess ? workbooks.get(String(id)) : null;
    if (!wb) throw new Error("No item with the given ID could be found, or you do not have permission to access it.");
    return new FakeSpreadsheet(wb);
  }
  function idFromUrl(url) {
    var m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(String(url));
    if (!m) throw new Error("Invalid argument: url");
    return m[1];
  }
  G.SpreadsheetApp = {
    openById: function (id) { return openBook(id); },
    openByUrl: function (url) { return openBook(idFromUrl(url)); },
    getActiveSpreadsheet: function () { return null; },
    create: refuse,
    open: refuse,
    flush: function () {},
  };

  // ------------------------------------------------ Sheets and Drive advanced services
  // Fakes for the export path. They record every call in __gasFakes.calls() and keep what was
  // created in __gasFakes.exports(); neither can ever touch the source workbook registry.
  G.Sheets = {
    Spreadsheets: {
      create: function (resource) {
        record("Sheets.Spreadsheets.create", { resource: resource });
        var id = "export-" + (++seq);
        var title = resource && resource.properties && resource.properties.title;
        var sheets = ((resource && resource.sheets) || [{}]).map(function (s, i) {
          return { properties: { sheetId: i, title: (s.properties && s.properties.title) || "Sheet" + (i + 1) } };
        });
        var ss = {
          spreadsheetId: id,
          spreadsheetUrl: ["https:", "", "docs.google.com", "spreadsheets", "d", id, "edit"].join("/"),
          properties: { title: title || "Untitled" },
          sheets: sheets,
        };
        exportsById.set(id, { spreadsheet: ss, values: {}, batches: [], permissions: [] });
        return clone(ss);
      },
      batchUpdate: function (resource, id) {
        record("Sheets.Spreadsheets.batchUpdate", { resource: resource, spreadsheetId: id });
        var e = exportsById.get(id);
        if (!e) throw new Error("Requested entity was not found.");
        e.batches.push(clone(resource));
        return { spreadsheetId: id, replies: ((resource && resource.requests) || []).map(function () { return {}; }) };
      },
      Values: {
        update: function (resource, id, range, opts) {
          record("Sheets.Spreadsheets.Values.update", { resource: resource, spreadsheetId: id, range: range, optionalArgs: opts });
          var e = exportsById.get(id);
          if (!e) throw new Error("Requested entity was not found.");
          e.values[range] = clone(resource && resource.values);
          var rows = (resource && resource.values) || [];
          return { spreadsheetId: id, updatedRange: range, updatedRows: rows.length, updatedCells: rows.reduce(function (n, r) { return n + r.length; }, 0) };
        },
      },
    },
  };
  G.Drive = {
    Permissions: {
      create: function (resource, fileId, opts) {
        record("Drive.Permissions.create", { resource: resource, fileId: fileId, optionalArgs: opts });
        var e = exportsById.get(fileId);
        if (e) e.permissions.push(clone(resource));
        return { id: "perm-" + (++seq), type: resource && resource.type, role: resource && resource.role };
      },
    },
  };

  // ------------------------------------------------------------------ test handle
  function loadWorkbook(wb, o) {
    var book = clone(wb);
    if (o && o.empty) book.tabs.forEach(function (t) { t.rows = t.rows.slice(0, 1); });
    if (o && o.tz) book.tz = o.tz;
    workbooks.set(book.id, book);
    return book.id;
  }
  /** The default Script Properties of the dev harness. Flags: mode, admins, nosource. */
  function seedDefaults(o) {
    o = o || {};
    effectiveUser = OWNER;
    var p = G.PropertiesService.getScriptProperties();
    p.setProperty("ALLOWED_ADMINS", o.admins != null ? o.admins : "admin@example.com");
    p.setProperty("ALLOWED_USERS", "viewer@example.com");
    if (o.mode === "org") p.setProperty("ACCESS_MODE", "org");
    if (o.nosource || !o.sheetId) return;
    var tab = function (name, pick) { return { name: name, joinColumn: "UUID", joinOn: "id", pick: pick }; };
    p.setProperty("CFG_SOURCE", JSON.stringify({
      sheetId: o.sheetId,
      cacheMinutes: 10,
      tabs: { apps: tab("Apps", "first"), ciat: tab("CIAT", "first"), aud: tab("Audits", "latest"), drp: tab("DRP", "latest"), plat: tab("Platform", "first") },
    }));
  }
  function pristine() {
    props.clear(); cache.clear(); calls.length = 0; exportsById.clear(); htmlFiles.clear();
    clockOffset = 0; sourceAccess = true; cacheDisabled = false; activeUser = OWNER; effectiveUser = OWNER;
    lockHeldElsewhere = false; lockHeldByUs = false; sheetTz = "Europe/Paris"; seq = 0;
    Object.keys(counters).forEach(function (k) { counters[k] = 0; });
    propGetKeys = Object.create(null);
  }

  G.__gasFakes = {
    WRITE_ERROR: WRITE_ERROR,
    OWNER: OWNER,
    counters: function () { return Object.assign({}, counters, { propGetKeys: Object.assign({}, propGetKeys) }); },
    resetCounters: function () {
      Object.keys(counters).forEach(function (k) { counters[k] = 0; });
      propGetKeys = Object.create(null);
    },
    /** Every Sheets and Drive advanced-service call, in order. */
    calls: function () { return clone(calls); },
    /** Spreadsheets created through the Sheets fake, with their values, batches and permissions. */
    exports: function () { return clone(Array.from(exportsById.values())); },
    loadWorkbook: loadWorkbook,
    seedDefaults: seedDefaults,
    setActiveUser: function (email) { activeUser = String(email || ""); },
    setEffectiveUser: function (email) { effectiveUser = String(email || ""); },
    setSourceAccess: function (ok) { sourceAccess = !!ok; },
    setCacheDisabled: function (off) { cacheDisabled = !!off; },
    clearCache: function () { cache.clear(); },
    holdLock: function (held) { lockHeldElsewhere = !!held; },
    setHtmlFile: function (name, content) { htmlFiles.set(name, String(content)); },
    /** Move the fake clock forward (cache expiry, lock timeouts). */
    advance: function (ms) { clockOffset += ms; },
    now: now,
    reset: pristine,
    snapshot: function () {
      return {
        props: new Map(props), cache: new Map(cache), clockOffset: clockOffset, activeUser: activeUser,
        effectiveUser: effectiveUser, calls: calls.slice(),
      };
    },
    restore: function (s) {
      props.clear(); s.props.forEach(function (v, k) { props.set(k, v); });
      cache.clear(); s.cache.forEach(function (v, k) { cache.set(k, v); });
      clockOffset = s.clockOffset; activeUser = s.activeUser; effectiveUser = s.effectiveUser;
      calls.length = 0; s.calls.forEach(function (c) { calls.push(c); });
    },
  };
})();
