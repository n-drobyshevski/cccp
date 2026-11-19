// Interactive prompts for the gas-kit CLI. Internal module, no dependencies, node:readline only.
// Only this module writes ANSI escapes. Every dynamic string (a choice label, an answer, a value read from a
// file) goes through sanitize() before it is written, so it cannot repaint the terminal. Every function takes
// injectable { input, output, env, flags } so tests can drive it with fake streams.
import { emitKeypressEvents } from "node:readline";

/** Thrown when the person presses Ctrl-C or Esc, or when their input ends. The CLI exits 130; what was already done is for the caller to say. */
export class CancelError extends Error {
  /** @param {"escape" | "interrupt"} [by] which key cancelled (the home menu treats Esc as quit, Ctrl-C as a cancel) */
  constructor(by = "interrupt") {
    super("cancelled");
    this.name = "CancelError";
    this.exitCode = 130;
    this.by = by;
  }
}

/**
 * @typedef {object} UiOptions
 * @property {any} [input] default process.stdin
 * @property {any} [output] default process.stdout
 * @property {Record<string, string | undefined>} [env] default process.env
 * @property {Record<string, string | boolean | undefined>} [flags] parsed flags: yes, plain, noColor or "no-color"
 */

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * A string fit to print on one line: a tab becomes a space, every other control character (escape, carriage
 * return, newline, DEL, C1) is shown as "?". Same rule as plainLine in bin.mjs, plus the tab.
 * @param {unknown} value
 */
export function sanitize(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(CONTROL, "?");
}

/** @param {UiOptions} o */
function streams(o) {
  return { input: o.input ?? process.stdin, output: o.output ?? process.stdout, env: o.env ?? process.env, flags: o.flags ?? {} };
}

/**
 * True when prompts may be asked: stdin and stdout are terminals, --yes is not given, and the run is not CI
 * or a dumb terminal. Piped input, CI and --yes keep the non-interactive behaviour.
 * @param {UiOptions} [opts]
 */
export function isInteractive(opts = {}) {
  const { input, output, env, flags } = streams(opts);
  if (flags["yes"] === true) return false;
  if (env["CI"] && env["CI"] !== "0" && env["CI"] !== "false") return false;
  if (env["TERM"] === "dumb") return false;
  return Boolean(input && input.isTTY && output && output.isTTY);
}

/** @param {string} what @param {UiOptions} opts */
function assertInteractive(what, opts) {
  if (!isInteractive(opts)) throw new Error("ui." + what + " needs an interactive terminal (stdin and stdout are TTYs, no --yes, not CI); check isInteractive() first");
}

/**
 * Colour helpers. Off for NO_COLOR, --plain, --no-color, a dumb terminal and any output that is not a TTY.
 * Shapes and words carry every status, so colour is only ever decoration.
 * @param {UiOptions} [opts]
 */
export function makeStyle(opts = {}) {
  const { output, env, flags } = streams(opts);
  const on = Boolean(output && output.isTTY) && !env["NO_COLOR"] && env["TERM"] !== "dumb" && flags["plain"] !== true && flags["no-color"] !== true && flags["noColor"] !== true;
  /** @param {number} code */
  const wrap = (code) => (/** @type {string} */ s) => (on ? "\u001b[" + code + "m" + s + "\u001b[39m" : s);
  return {
    enabled: on,
    bold: (/** @type {string} */ s) => (on ? "\u001b[1m" + s + "\u001b[22m" : s),
    dim: (/** @type {string} */ s) => (on ? "\u001b[2m" + s + "\u001b[22m" : s),
    cyan: wrap(36),
    green: wrap(32),
    red: wrap(31),
    yellow: wrap(33),
  };
}

/**
 * A two-cell truecolour block for a #rrggbb swatch, or "" when colour is off, the terminal does not say
 * it handles 24-bit colour, or the value is not exactly #rrggbb (so a value read from a file cannot smuggle
 * anything into the escape). Shapes and words carry the meaning: the hex always appears in the hint.
 * @param {string | undefined} hex @param {UiOptions} opts
 */
function swatchOf(hex, opts) {
  const { env } = streams(opts);
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex) || !makeStyle(opts).enabled || !/^(truecolor|24bit)$/i.test(env["COLORTERM"] ?? "")) return "";
  const n = parseInt(hex.slice(1), 16);
  return "\u001b[48;2;" + ((n >> 16) & 255) + ";" + ((n >> 8) & 255) + ";" + (n & 255) + "m  \u001b[49m ";
}

/** Cut to max characters (whole code points, so a surrogate pair is never split), ending in an ellipsis. @param {string} s @param {number} max */
function clip(s, max) {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, Math.max(1, max - 1)).join("") + "…" : s;
}

/** The last max characters of what is being typed, so the input line never wraps. @param {string} s @param {number} max */
function tail(s, max) {
  const chars = Array.from(s);
  return chars.length > max ? "…" + chars.slice(-Math.max(1, max - 1)).join("") : s;
}

/** A redrawable block of lines: each draw replaces the last. @param {any} output */
function makeScreen(output) {
  let n = 0;
  const up = () => (n ? "\u001b[" + n + "A\r\u001b[J" : "");
  return {
    /** @param {string[]} lines */
    draw(lines) {
      output.write(up() + lines.join("\n") + "\n");
      n = lines.length;
    },
    clear() {
      output.write(up());
      n = 0;
    },
  };
}

/**
 * Run one prompt: raw keys in, frames out. Restores the terminal in finally.
 * @template T
 * @param {string} what
 * @param {UiOptions} opts
 * @param {{ frame: (final: boolean) => string[], key: (str: string, key: any) => { done: T } | void }} h
 * @returns {Promise<T>}
 */
async function session(what, opts, h) {
  assertInteractive(what, opts);
  const { input, output } = streams(opts);
  emitKeypressEvents(input);
  const wasRaw = Boolean(input.isRaw);
  const screen = makeScreen(output);
  /** @type {(k: string, key: any) => void} */
  let listener = () => {};
  // Input that ends (EOF, hangup) while a prompt waits is a cancel, not a hang.
  /** @type {() => void} */
  let ended = () => {};
  try {
    if (typeof input.setRawMode === "function") input.setRawMode(true);
    input.resume();
    output.write("\u001b[?25l");
    return await new Promise((resolve, reject) => {
      ended = () => {
        screen.clear();
        reject(new CancelError("interrupt"));
      };
      if (typeof input.once === "function") {
        input.once("end", ended);
        input.once("close", ended);
      }
      screen.draw(h.frame(false));
      listener = (str, key = {}) => {
        if ((key.ctrl && (key.name === "c" || key.name === "d")) || key.name === "escape") {
          screen.clear();
          reject(new CancelError(key.name === "escape" ? "escape" : "interrupt"));
          return;
        }
        try {
          const r = h.key(str, key);
          if (r) {
            screen.draw(h.frame(true));
            resolve(r.done);
          } else screen.draw(h.frame(false));
        } catch (e) {
          reject(e);
        }
      };
      input.on("keypress", listener);
    });
  } finally {
    input.off("keypress", listener);
    if (typeof input.off === "function") {
      input.off("end", ended);
      input.off("close", ended);
    }
    if (typeof input.setRawMode === "function") input.setRawMode(wasRaw);
    input.pause();
    output.write("\u001b[?25h");
  }
}

/** @param {UiOptions} opts @param {string} message @param {string} [hint] @param {boolean} [final] @param {string} [answer] */
function head(opts, message, hint, final, answer) {
  const s = makeStyle(opts);
  const cols = (streams(opts).output.columns || 80) - 8;
  if (final) return [s.dim("◇") + "  " + sanitize(clip(message, cols)), s.dim("│") + "  " + s.cyan(clip(sanitize(answer), cols)), s.dim("│")];
  const lines = [s.cyan("◆") + "  " + s.bold(sanitize(clip(message, cols)))];
  if (hint) lines.push(s.dim("│  " + sanitize(clip(hint, cols))));
  return lines;
}

/**
 * Pick one of several choices with the arrow keys, or a number key 1 to 9. Disabled choices are shown but
 * cannot be picked (a string is shown as the reason).
 * @template V
 * An optional keys map (a single letter to a value, e.g. q) answers at once, and footer replaces the key hint line.
 * @param {UiOptions & { message: string, hint?: string, choices: Array<{ value: V, label: string, hint?: string, disabled?: boolean | string, swatch?: string }>, initial?: V, keys?: Record<string, V>, keyLabels?: Record<string, string>, footer?: string }} o
 * @returns {Promise<V>}
 */
export function select(o) {
  const choices = o.choices;
  const enabled = (/** @type {number} */ i) => !choices[i]?.disabled;
  if (!choices.some((_, i) => enabled(i))) throw new Error("ui.select needs at least one choice that is not disabled");
  let at = Math.max(0, choices.findIndex((c) => c.value === o.initial));
  if (!enabled(at)) at = choices.findIndex((_, i) => enabled(i));
  const s = makeStyle(o);
  let said = "";
  const cols = (streams(o).output.columns || 80) - 12;
  const move = (/** @type {number} */ d) => {
    for (let i = 1; i <= choices.length; i++) {
      const j = (at + d * i + choices.length * i) % choices.length;
      if (enabled(j)) return void (at = j);
    }
  };
  return session("select", o, {
    frame(final) {
      if (final) return head(o, o.message, "", true, said || choices[at]?.label);
      const lines = head(o, o.message, o.hint);
      choices.forEach((c, i) => {
        const num = i < 9 ? String(i + 1) : " ";
        // The whole line fits the terminal (a wrapped line would leave stale rows on every redraw): the label first,
        // then the hint and the reason in what is left; the swatch takes 3 cells.
        const swatch = swatchOf(c.swatch, o);
        let room = cols - (swatch ? 3 : 0);
        const label = clip(sanitize(c.label), Math.max(1, room));
        room -= Array.from(label).length;
        /** @param {string} t */
        const extra = (t) => {
          if (room < 6) return "";
          const shownText = clip(sanitize(t), room - 3);
          room -= 3 + Array.from(shownText).length;
          return "   " + shownText;
        };
        const hintText = c.hint ? extra(c.hint) : "";
        const reason = c.disabled ? extra("(" + (typeof c.disabled === "string" ? c.disabled : "not available") + ")") : "";
        const text = swatch + label + (hintText ? s.dim(hintText) : "") + (reason ? s.dim(reason) : "");
        const mark = c.disabled ? "–" : i === at ? s.cyan("●") : "○";
        lines.push(s.dim("│") + "  " + mark + " " + s.dim(num) + "  " + (c.disabled ? s.dim(text) : i === at ? s.bold(text) : text));
      });
      lines.push(s.dim("└  " + clip(o.footer ? sanitize(o.footer) : "↑↓ move · enter choose · 1-" + Math.min(9, choices.length) + " pick by number · esc cancel", cols)));
      return lines;
    },
    key(str, key) {
      if (key.name === "up") move(-1);
      else if (key.name === "down") move(1);
      else if (key.name === "return" || key.name === "enter") return { done: /** @type {V} */ (choices[at]?.value) };
      else if (o.keys && typeof str === "string" && Object.prototype.hasOwnProperty.call(o.keys, str)) {
        said = o.keyLabels?.[str] ?? "";
        return { done: /** @type {V} */ (o.keys[str]) };
      }
      else if (/^[1-9]$/.test(str ?? "")) {
        const i = Number(str) - 1;
        if (i < choices.length && enabled(i)) {
          at = i;
          return { done: /** @type {V} */ (choices[i]?.value) };
        }
      }
    },
  });
}

/**
 * Yes or no. Left and right (or y and n) choose, enter confirms.
 * @param {UiOptions & { message: string, hint?: string, initial?: boolean }} o
 * @returns {Promise<boolean>}
 */
export function confirm(o) {
  let yes = o.initial !== false;
  const s = makeStyle(o);
  return session("confirm", o, {
    frame(final) {
      if (final) return head(o, o.message, "", true, yes ? "Yes" : "No");
      const lines = head(o, o.message, o.hint);
      const opt = (/** @type {boolean} */ v, /** @type {string} */ label) => (yes === v ? s.cyan("●") + " " + s.bold(label) : "○ " + label);
      lines.push(s.dim("│") + "  " + opt(true, "Yes") + "   " + opt(false, "No"));
      lines.push(s.dim("└  ←→ choose · y / n · enter confirm · esc cancel"));
      return lines;
    },
    key(str, key) {
      if (key.name === "left" || key.name === "right" || key.name === "tab") yes = !yes;
      else if (str === "y" || str === "Y") return { done: (yes = true) };
      else if (str === "n" || str === "N") return { done: (yes = false) };
      else if (key.name === "return" || key.name === "enter") return { done: yes };
    },
  });
}

/**
 * Free text with an optional default (editable), a placeholder and a check. A check that returns a message
 * keeps the question open and shows the message under it.
 * @param {UiOptions & { message: string, hint?: string, initial?: string, placeholder?: string, validate?: (value: string) => string | null | undefined | false | void }} o
 * @returns {Promise<string>}
 */
export function text(o) {
  let buf = o.initial ?? "";
  /** @type {string} */
  let problem = "";
  const s = makeStyle(o);
  return session("text", o, {
    frame(final) {
      if (final) return head(o, o.message, "", true, buf.trim());
      const lines = head(o, o.message, o.hint);
      const width = (streams(o).output.columns || 80) - 8;
      const shown = buf ? tail(sanitize(buf), width) : o.placeholder ? s.dim(clip(sanitize(o.placeholder), width)) : "";
      lines.push(s.dim("│") + "  " + shown + s.dim("▏"));
      if (problem) lines.push(s.dim("│") + "  " + s.red("✖ " + clip(sanitize(problem), width)));
      lines.push(s.dim("└  enter confirm · esc cancel"));
      return lines;
    },
    key(str, key) {
      if (key.name === "return" || key.name === "enter") {
        const value = buf.trim();
        const why = o.validate ? o.validate(value) : null;
        if (why) {
          problem = String(why);
          return;
        }
        return { done: value };
      }
      problem = "";
      if (key.name === "backspace") buf = Array.from(buf).slice(0, -1).join("");
      else if (key.ctrl && key.name === "u") buf = "";
      else if (str && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f-\u009f]/.test(str)) buf += str;
    },
  });
}

/**
 * Format a titled key/value block ("Ready to create"). Pure: returns lines, every value sanitised.
 * @param {string} title
 * @param {Array<[string, string]>} rows
 * @param {UiOptions} [opts]
 * @returns {string[]}
 */
export function summaryLines(title, rows, opts = {}) {
  const s = makeStyle(opts);
  const clean = rows.map(([k, v]) => [sanitize(k), sanitize(v)]);
  const kw = Math.max(0, ...clean.map(([k]) => /** @type {string} */ (k).length));
  const body = clean.map(([k, v]) => "  " + /** @type {string} */ (k).padEnd(kw) + "   " + v);
  const t = sanitize(title);
  const width = Math.max(t.length + 4, ...body.map((l) => l.length + 2));
  return [
    s.dim("◇") + "  " + s.bold(t) + " " + s.dim("─".repeat(Math.max(1, width - t.length - 4)) + "╮"),
    s.dim("│") + " ".repeat(width) + s.dim("│"),
    ...body.map((l) => s.dim("│") + l.padEnd(width) + s.dim("│")),
    s.dim("│") + " ".repeat(width) + s.dim("│"),
    s.dim("├" + "─".repeat(width) + "╯"),
  ];
}

/**
 * Print a summary block.
 * @param {string} title @param {Array<[string, string]>} rows @param {UiOptions} [opts]
 */
export function summary(title, rows, opts = {}) {
  for (const l of summaryLines(title, rows, opts)) streams(opts).output.write(l + "\n");
}

/** Print one note line under the rail (dim when asked). @param {string} message @param {UiOptions & { dim?: boolean }} [opts] */
export function note(message, opts = {}) {
  const s = makeStyle(opts);
  streams(opts).output.write(s.dim("│") + "  " + (opts.dim ? s.dim(sanitize(message)) : sanitize(message)) + "\n");
}

/**
 * Print plain lines (an error block, a next step). Each is sanitised first, so text from a file or a
 * command cannot repaint the terminal; a line is dimmed or bold only through the options.
 * @param {string[]} lines @param {UiOptions & { dim?: boolean }} [opts]
 */
export function print(lines, opts = {}) {
  const s = makeStyle(opts);
  for (const l of lines) streams(opts).output.write((opts.dim ? s.dim(sanitize(l)) : sanitize(l)) + "\n");
}

/**
 * Print report rows. A row with a status gets its fixed mark painted (green, yellow, red or cyan; colour only
 * when the style allows) and its text sanitised after, so untrusted text can never carry an escape; a row
 * without a status is just sanitised text. Shapes and words carry the status, colour is decoration.
 * @param {Array<{ status?: "ok" | "warn" | "fail" | "info", mark?: string, text: string }>} rows @param {UiOptions} [opts]
 */
export function report(rows, opts = {}) {
  const s = makeStyle(opts);
  const paint = { ok: s.green, warn: s.yellow, fail: s.red, info: s.cyan };
  for (const r of rows) {
    const mark = r.status && r.mark ? "  " + paint[r.status](r.mark) + " " : "";
    streams(opts).output.write(mark + sanitize(r.text) + "\n");
  }
}

/** Print the closing line. @param {string} message @param {UiOptions} [opts] */
export function outro(message, opts = {}) {
  const s = makeStyle(opts);
  streams(opts).output.write(s.dim("└") + "  " + sanitize(message) + "\n");
}

/** @param {number} ms */
function seconds(ms) {
  return (ms / 1000).toFixed(1) + "s";
}

/**
 * Run tasks one after another, each shown as a spinner line that ends in "✔ title (1.2s)" or "✖ title".
 * Not on a TTY (or in CI) it prints plain lines instead. A failing task prints its ✖ line and rethrows.
 * @param {Array<{ title: string, run: () => unknown | Promise<unknown>, doneTitle?: (result: any, took: string) => string, inlineTime?: boolean }>} tasks
 * @param {UiOptions & { now?: () => number, intervalMs?: number }} [opts]
 * @returns {Promise<unknown[]>}
 */
export async function steps(tasks, opts = {}) {
  const { output, env } = streams(opts);
  const s = makeStyle(opts);
  const now = opts.now ?? (() => Date.now());
  const live = Boolean(output.isTTY) && opts.flags?.["plain"] !== true && opts.flags?.["no-color"] !== true && opts.flags?.["noColor"] !== true && env["TERM"] !== "dumb" && !(env["CI"] && env["CI"] !== "0" && env["CI"] !== "false");
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  /** @type {unknown[]} */
  const results = [];
  for (const task of tasks) {
    const title = sanitize(task.title);
    const t0 = now();
    let i = 0;
    /** @type {ReturnType<typeof setInterval> | null} */
    let timer = null;
    if (live) {
      const paint = () => output.write("\r\u001b[K" + s.cyan(frames[i++ % frames.length] ?? "…") + " " + title);
      paint();
      timer = setInterval(paint, opts.intervalMs ?? 80);
    } else output.write("- " + title + "\n");
    const done = (/** @type {string} */ mark, /** @type {(x: string) => string} */ paint, /** @type {string} */ shown = title, /** @type {boolean} */ inline = false) => {
      if (timer) clearInterval(timer);
      output.write((live ? "\r\u001b[K" : "") + paint(mark) + " " + shown + (mark === "✔" && !inline ? " (" + seconds(now() - t0) + ")" : "") + "\n");
    };
    try {
      const result = await task.run();
      results.push(result);
      done("✔", s.green, task.doneTitle ? sanitize(task.doneTitle(result, seconds(now() - t0))) : title, task.inlineTime);
    } catch (e) {
      done("✖", s.red);
      throw e;
    }
  }
  return results;
}
