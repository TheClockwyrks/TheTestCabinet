// The faces a headless 2D frame is drawn in. 2D ONLY.
//
// A build names its fonts the way a page does — `700 21px ui-monospace, monospace`
// — and in a browser the platform's font configuration answers every part of
// that: a GENERIC family (`monospace`, `sans-serif`, `serif`, `system-ui`, …)
// resolves to the host's face for that role, and a glyph the chosen face lacks
// falls through, glyph by glyph, to whichever installed face carries it. The
// `@napi-rs/canvas` context an engine harness draws into does neither on its own.
// It takes the FIRST family in the list it can find by name and falls through
// the REST of the list per glyph, but a generic family is not a name it knows,
// so a list of generics alone resolves to nothing and lands on whichever face
// the library happened to load first — a proportional Latin face on the hosts
// seen so far — and past the end of the list there is no fallback at all: a
// glyph no listed face carries is drawn as the missing-glyph box.
//
// THAT BOX IS A READING ERROR, NOT A BUILD'S. A HUD that marks its five bays
// `◆ ◇ ◇ ◆ ◇`, a heart per life or an arrow per direction is legible in every
// browser, and a validator that reads the bar's pixels sees five identical boxes
// and reports that no bay has a mark. So every context this package hands a
// build resolves the font it was set the way the browser would: each generic
// family is replaced by the host's face for its role, and a tail of the host's
// broad-coverage faces is appended so a glyph the named faces lack still lands on
// one. The build's own named families stay first and keep their metrics; only
// what it left to the host is decided here.
//
// WHAT A BUILD READS BACK IS WHAT IT SET. `ctx.font` reports the string the build
// assigned, not the resolved one, so a build that saves and restores its font by
// hand sees its own value and the recorder's `set font` entry carries it too.
// An invalid font string is ignored and leaves the font in force, as the CSS
// shorthand's own rule has a browser do, rather than thrown out of the frame.
//
// THE HOST'S FACES ARE FOUND, NOT ASSUMED. Each role has a preference list and
// the first face the library registered from the host wins; a host with none of
// them leaves that role to the library's own default, exactly as before. Nothing
// here registers a font file, so the set of faces stays the host's.

import {
  GlobalFonts,
  createCanvas,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";

/** The role a generic family asks the host to fill. */
type Role = "mono" | "sans" | "serif" | "emoji";

/** Every CSS generic family, and the role each stands for. */
const GENERIC: Readonly<Record<string, Role>> = {
  monospace: "mono",
  "ui-monospace": "mono",
  "sans-serif": "sans",
  "system-ui": "sans",
  "ui-sans-serif": "sans",
  "ui-rounded": "sans",
  cursive: "sans",
  fantasy: "sans",
  math: "sans",
  fangsong: "sans",
  serif: "serif",
  "ui-serif": "serif",
  emoji: "emoji",
};

/**
 * The faces that may fill each role, most preferred first, by the family name
 * the library registers them under.
 *
 * The first three lists are the faces a Linux font configuration hands a browser
 * for the three generic roles, then the metric-compatible substitutes for the
 * common proprietary faces, then the faces those hosts carry as well. The last
 * four are the fallback TAIL — broad Latin, Greek, Cyrillic and symbol coverage
 * first, then the faces that cover the rest of the plane, emoji and the CJK
 * scripts — in the order a glyph is looked for.
 */
const FACES: Readonly<
  Record<Role | "symbols" | "wide" | "cjk", readonly string[]>
> = {
  mono: [
    "DejaVu Sans Mono",
    "Liberation Mono",
    "Noto Sans Mono",
    "FreeMono",
    "Courier New",
    "Menlo",
    "Consolas",
  ],
  sans: [
    "DejaVu Sans",
    "Liberation Sans",
    "Noto Sans",
    "FreeSans",
    "Arial",
    "Helvetica",
  ],
  serif: [
    "DejaVu Serif",
    "Liberation Serif",
    "Noto Serif",
    "FreeSerif",
    "Times New Roman",
    "Times",
  ],
  emoji: ["Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"],
  symbols: ["DejaVu Sans", "Symbola", "Noto Sans Symbols2", "FreeSerif"],
  wide: ["Unifont", "Unifont Upper"],
  cjk: ["Noto Sans CJK JP", "WenQuanYi Zen Hei", "IPAGothic"],
};

/** The family names the library registered from the host, by lower-cased name. */
let registered: Map<string, string> | undefined;

function families(): Map<string, string> {
  if (registered === undefined) {
    registered = new Map();
    for (const { family } of GlobalFonts.families) {
      registered.set(family.toLowerCase(), family);
    }
  }
  return registered;
}

/** The first face of `candidates` the host carries, by its registered name. */
function firstRegistered(candidates: readonly string[]): string | undefined {
  const known = families();
  for (const candidate of candidates) {
    const found = known.get(candidate.toLowerCase());
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The host's face for a generic role, or `undefined` on a host with none. */
export function hostFace(role: Role): string | undefined {
  return firstRegistered(FACES[role]);
}

/**
 * The fallback tail: the host's faces a glyph falls through to when no family
 * the build named carries it, in the order they are tried.
 */
export function fallbackFaces(): string[] {
  const tail: string[] = [];
  for (const group of [
    "sans",
    "symbols",
    "mono",
    "wide",
    "emoji",
    "cjk",
  ] as const) {
    const face = firstRegistered(FACES[group]);
    if (face !== undefined && !tail.includes(face)) tail.push(face);
  }
  return tail;
}

/**
 * The font-size token of a CSS font shorthand — the last thing before the family
 * list — with its optional `/line-height`, followed by the whitespace that
 * separates it from the families.
 */
const SIZE_TOKEN =
  /(?:^|\s)(?:(?:\d*\.\d+|\d+)(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|vw|vh|vmin|vmax|%)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller)(?:\/[^\s]+)?\s+/i;

/** Split a family list on the commas outside its quoted names. */
function splitFamilies(list: string): string[] {
  const names: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (const char of list) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      names.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  names.push(current.trim());
  return names.filter((name) => name.length > 0);
}

/** A family name as the shorthand takes it: quoted unless it is a bare identifier. */
function quoteFamily(name: string): string {
  return /^[A-Za-z_-][\w-]*$/.test(name) ? name : `"${name.replace(/"/g, "")}"`;
}

/**
 * The font a headless context is set to for the shorthand a build set.
 *
 * Every generic family is replaced by the host's face for its role and the
 * {@link fallbackFaces} are appended, skipping any face already listed. The
 * families the build named stay first, in its order, so their metrics are the
 * ones the frame is drawn with. A string with no font-size token is not a
 * shorthand this can read and is returned as it is.
 */
export function resolveFont(value: string): string {
  const size = SIZE_TOKEN.exec(value);
  if (size === null) return value;
  const split = size.index + size[0].length;
  const prefix = value.slice(0, split);
  const listed = splitFamilies(value.slice(split));
  if (listed.length === 0) return value;

  const resolved: string[] = [];
  const add = (name: string): void => {
    if (!resolved.some((seen) => seen.toLowerCase() === name.toLowerCase())) {
      resolved.push(name);
    }
  };
  for (const name of listed) {
    const role = GENERIC[name.toLowerCase()];
    if (role === undefined) {
      add(name);
      continue;
    }
    const face = hostFace(role);
    add(face ?? name);
  }
  for (const face of fallbackFaces()) add(face);
  return prefix + resolved.map(quoteFamily).join(", ");
}

/** The most recent resolutions, so the getter can hand back what was set. */
const MEMORY = 512;

/** The contexts already resolving, so a second `getContext` installs nothing. */
const installed = new WeakSet<object>();

/** The font a context starts under in a page, resolved the same way. */
const DEFAULT_FONT = "10px sans-serif";

/**
 * Make `ctx` resolve every font it is set to through {@link resolveFont}, and
 * report the value it was set rather than the resolution.
 *
 * Installed on the context's own object, over the library's prototype accessor,
 * so every path to the property — the build's own assignment, the recorder's
 * forwarded set, an engine's overlay — goes through it.
 */
export function installFontResolution(ctx: SKRSContext2D): void {
  if (installed.has(ctx)) return;
  const proto = Object.getPrototypeOf(ctx) as object;
  const accessor = Object.getOwnPropertyDescriptor(proto, "font");
  if (accessor?.get === undefined || accessor.set === undefined) return;
  installed.add(ctx);
  const read = accessor.get;
  const write = accessor.set;
  const originals = new Map<string, string>();
  Object.defineProperty(ctx, "font", {
    configurable: true,
    enumerable: accessor.enumerable ?? false,
    get(): string {
      const inForce = read.call(ctx) as string;
      return originals.get(inForce) ?? inForce;
    },
    set(value: unknown): void {
      const asSet = String(value);
      const resolved = resolveFont(asSet);
      try {
        write.call(ctx, resolved);
      } catch {
        // An invalid shorthand leaves the font in force, as it does in a page.
        return;
      }
      if (originals.size >= MEMORY) originals.clear();
      originals.set(resolved, asSet);
    },
  });
  // The default a page starts under, so a build that never sets a font draws
  // with the host's face and its coverage rather than the library's own default.
  ctx.font = DEFAULT_FONT;
}

/**
 * A canvas of the library's own, whose 2D context resolves its fonts as the
 * screen does — what `document.createElement("canvas")` hands a build that draws
 * or measures text off-screen.
 */
export function createHostCanvas(width: number, height: number): Canvas {
  const canvas = createCanvas(width, height);
  const native = canvas.getContext.bind(canvas) as (
    ...args: unknown[]
  ) => SKRSContext2D;
  return Object.assign(canvas, {
    getContext(...args: unknown[]): SKRSContext2D {
      const ctx = native(...args);
      if (args[0] === "2d") installFontResolution(ctx);
      return ctx;
    },
  });
}
