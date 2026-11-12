// A STORED (uncompressed) zip writer with CRC-32: enough for an xlsx, and small enough to read
// in full. Entries are {name, data} with data a string (UTF-8 encoded here) or a Uint8Array.
// Names are written with the UTF-8 flag. The time stamp is fixed so the same input always
// gives the same bytes.

const enc = new TextEncoder();

let table = null;
function crcTable() {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 of a byte array, as an unsigned integer. */
export function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 1980-01-01 00:00:00 in DOS date and time.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const u16 = (v, n, o) => { v[o] = n & 255; v[o + 1] = (n >>> 8) & 255; };
const u32 = (v, n, o) => { u16(v, n & 0xffff, o); u16(v, (n >>> 16) & 0xffff, o + 2); };

/** The zip file for `entries`, as a Uint8Array. */
export function zipStore(entries) {
  const files = entries.map((e) => {
    const name = enc.encode(e.name);
    const data = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    return { name, data, crc: crc32(data) };
  });
  let size = 22;
  for (const f of files) size += 30 + f.name.length + f.data.length + 46 + f.name.length;
  const out = new Uint8Array(size);
  const offsets = [];
  let p = 0;
  for (const f of files) {
    offsets.push(p);
    u32(out, 0x04034b50, p);
    u16(out, 20, p + 4);
    u16(out, 0x0800, p + 6);
    u16(out, 0, p + 8);
    u16(out, DOS_TIME, p + 10);
    u16(out, DOS_DATE, p + 12);
    u32(out, f.crc, p + 14);
    u32(out, f.data.length, p + 18);
    u32(out, f.data.length, p + 22);
    u16(out, f.name.length, p + 26);
    u16(out, 0, p + 28);
    out.set(f.name, p + 30);
    out.set(f.data, p + 30 + f.name.length);
    p += 30 + f.name.length + f.data.length;
  }
  const dirStart = p;
  files.forEach((f, i) => {
    u32(out, 0x02014b50, p);
    u16(out, 20, p + 4);
    u16(out, 20, p + 6);
    u16(out, 0x0800, p + 8);
    u16(out, 0, p + 10);
    u16(out, DOS_TIME, p + 12);
    u16(out, DOS_DATE, p + 14);
    u32(out, f.crc, p + 16);
    u32(out, f.data.length, p + 20);
    u32(out, f.data.length, p + 24);
    u16(out, f.name.length, p + 28);
    u16(out, 0, p + 30);
    u16(out, 0, p + 32);
    u16(out, 0, p + 34);
    u16(out, 0, p + 36);
    u32(out, 0, p + 38);
    u32(out, offsets[i], p + 42);
    out.set(f.name, p + 46);
    p += 46 + f.name.length;
  });
  u32(out, 0x06054b50, p);
  u16(out, 0, p + 4);
  u16(out, 0, p + 6);
  u16(out, files.length, p + 8);
  u16(out, files.length, p + 10);
  u32(out, p - dirStart, p + 12);
  u32(out, dirStart, p + 16);
  u16(out, 0, p + 20);
  return out;
}
