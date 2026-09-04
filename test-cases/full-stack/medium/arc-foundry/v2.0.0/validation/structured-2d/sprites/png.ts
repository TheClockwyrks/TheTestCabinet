// Arc Foundry — the produced sprite files, and reading one. CASE-PROVIDED.
//
// WHAT THESE POINTS ARE DECIDED FROM. The committed files themselves.
// `specs/assets.md` fixes an exact path and an exact canvas size for every sprite
// the run produces, under `assets/` at the repository root, and this project's
// root is that repository — so a sprite is checked by opening the file the
// specification names and reading what is in it. Nothing here goes through the
// browser: whether the build DRAWS what it produced is a point of its own.
//
// WHY A DECODER LIVES HERE. The project has no image library and cannot take a
// dependency on one: it runs inside a build the model wrote, against that build's
// own `node_modules`. A PNG's header is four fields at a fixed offset, and its
// pixels are a zlib stream of filtered scanlines that `node:zlib` inflates, so
// both are a short read rather than a package.
//
// WHAT IT READS. Every PNG `draw` produces: eight bits a channel, not
// interlaced, greyscale, palette, or colour, with or without alpha. A file
// outside that is reported as what it is rather than guessed at, and the point
// that read it fails naming the encoding it found — which is the honest answer,
// since `specs/assets.md` asks for "a fixed-size straight-alpha RGBA canvas".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { fail } from "../assert";
import {
  COMBO_IDS,
  type ComboId,
  COMPONENT_TYPES,
  type ComponentType,
  FIRING_TYPES,
  type Tier,
  TIERS,
} from "../constants";

/* -------------------------------------------------------------------------- */
/* The paths specs/assets.md fixes                                            */
/* -------------------------------------------------------------------------- */

/** The absolute path of one produced asset, from its path under `assets/`. */
export function assetPath(relative: string): string {
  return fileURLToPath(new URL(`../../assets/${relative}`, import.meta.url));
}

/** One produced sprite: where it lands, and the canvas it is drawn on. */
export interface Sprite {
  path: string;
  width: number;
  height: number;
}

const at = (path: string, size: number): Sprite => ({
  path,
  width: size,
  height: size,
});

/** The yard's five (specs/assets.md). */
export const YARD_SPRITES: readonly Sprite[] = [
  at("yard/substrate.png", 40),
  at("yard/entry.png", 40),
  at("yard/collector.png", 40),
  at("yard/housing.png", 40),
  at("yard/waypoint.png", 20),
];

/** A base component's fixed mount. */
export const componentBase = (type: ComponentType): Sprite =>
  at(`components/${type}/base.png`, 40);

/** A base component's rotating head, at one quality tier. */
export const componentHead = (type: ComponentType, tier: Tier): Sprite =>
  at(`components/${type}/head-${tier}.png`, 40);

/** A combination tower's fixed mount. */
export const comboBase = (id: ComboId): Sprite =>
  at(`combos/${id}/base.png`, 40);

/** A combination tower's rotating head. It has no tier variants. */
export const comboHead = (id: ComboId): Sprite =>
  at(`combos/${id}/head.png`, 40);

/** The inert fused rock an unharvested candidate hardens into. */
export const BLOCKER: Sprite = at("blocker.png", 40);

/** A firing base type's travelling shot. */
export const projectile = (type: ComponentType): Sprite =>
  at(`projectiles/${type}.png`, 12);

/** The status bar's and the panel's marks. */
export const ICON_SPRITES: readonly Sprite[] = [
  at("icons/charge.png", 16),
  at("icons/integrity.png", 16),
  ...COMPONENT_TYPES.map((type) => at(`icons/type-${type}.png`, 16)),
];

/** Every still sprite `specs/assets.md` has the run produce. */
export function everySprite(): Sprite[] {
  return [
    ...YARD_SPRITES,
    ...COMPONENT_TYPES.map(componentBase),
    ...COMPONENT_TYPES.flatMap((type) =>
      TIERS.map((tier) => componentHead(type, tier)),
    ),
    ...COMBO_IDS.map(comboBase),
    ...COMBO_IDS.map(comboHead),
    BLOCKER,
    ...FIRING_TYPES.map(projectile),
    ...ICON_SPRITES,
  ];
}

/* -------------------------------------------------------------------------- */
/* Reading a PNG                                                              */
/* -------------------------------------------------------------------------- */

/** What a decoded sprite carries: its canvas, and its straight-alpha pixels. */
export interface Png {
  width: number;
  height: number;
  /** Four bytes a pixel, row by row from the top. */
  rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The file's bytes, or a reason it could not be read that names the path. */
function bytes(sprite: Sprite): Buffer {
  try {
    return readFileSync(assetPath(sprite.path));
  } catch {
    fail(
      `assets/${sprite.path} to be produced, at the path specs/assets.md fixes`,
      "no such file in the repository",
    );
  }
}

interface Header {
  width: number;
  height: number;
  depth: number;
  colour: number;
  interlace: number;
}

function header(file: Buffer, sprite: Sprite): Header {
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (file[i] !== SIGNATURE[i]) {
      fail(
        `assets/${sprite.path} to be a PNG (specs/assets.md)`,
        "a file carrying no PNG signature",
      );
    }
  }
  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
    depth: file[24]!,
    colour: file[25]!,
    interlace: file[28]!,
  };
}

/** The canvas a produced sprite was drawn on, read from its header alone. */
export function canvasOf(sprite: Sprite): { width: number; height: number } {
  const head = header(bytes(sprite), sprite);
  return { width: head.width, height: head.height };
}

/** How many bytes of a scanline one pixel takes, at eight bits a channel. */
const CHANNELS: Readonly<Record<number, number>> = {
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
};

/** The produced sprite, decoded to straight-alpha RGBA. */
export function decode(sprite: Sprite): Png {
  const file = bytes(sprite);
  const head = header(file, sprite);
  if (head.interlace !== 0) {
    fail(
      `assets/${sprite.path} to be a plain straight-alpha PNG ` +
        "(specs/assets.md)",
      "an interlaced PNG",
    );
  }
  if (head.depth !== 8) {
    fail(
      `assets/${sprite.path} to be eight bits a channel, as \`draw\` ` +
        "rasterizes one (specs/assets.md)",
      `${head.depth} bits a channel`,
    );
  }
  const channels = CHANNELS[head.colour];
  if (channels === undefined) {
    fail(
      `assets/${sprite.path} to carry a PNG colour type that has pixels ` +
        "(specs/assets.md)",
      `PNG colour type ${head.colour}`,
    );
  }

  const data: Buffer[] = [];
  let palette: Buffer | null = null;
  let alpha: Buffer | null = null;
  let at = 8;
  while (at + 8 <= file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString("ascii", at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === "IDAT") data.push(Buffer.from(body));
    else if (type === "PLTE") palette = Buffer.from(body);
    else if (type === "tRNS") alpha = Buffer.from(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (head.colour === 3 && palette === null) {
    fail(
      `assets/${sprite.path} to carry the palette its colour type names`,
      "a palette-indexed PNG with no PLTE chunk",
    );
  }

  const raw = inflateSync(Buffer.concat(data));
  const stride = head.width * channels;
  const lines = new Uint8Array(head.height * stride);
  let read = 0;
  for (let y = 0; y < head.height; y += 1) {
    const filter = raw[read]!;
    read += 1;
    const line = lines.subarray(y * stride, (y + 1) * stride);
    const above = y === 0 ? null : lines.subarray((y - 1) * stride, y * stride);
    for (let i = 0; i < stride; i += 1) {
      const value = raw[read + i]!;
      const a = i >= channels ? line[i - channels]! : 0;
      const b = above === null ? 0 : above[i]!;
      const c = above === null || i < channels ? 0 : above[i - channels]!;
      line[i] = unfilter(filter, value, a, b, c);
    }
    read += stride;
  }

  const rgba = new Uint8Array(head.width * head.height * 4);
  for (let i = 0; i < head.width * head.height; i += 1) {
    const source = i * channels;
    const out = i * 4;
    if (head.colour === 6) {
      rgba.set(lines.subarray(source, source + 4), out);
    } else if (head.colour === 2) {
      rgba.set(lines.subarray(source, source + 3), out);
      rgba[out + 3] = 255;
    } else if (head.colour === 0) {
      const grey = lines[source]!;
      rgba.set([grey, grey, grey, 255], out);
    } else if (head.colour === 4) {
      const grey = lines[source]!;
      rgba.set([grey, grey, grey, lines[source + 1]!], out);
    } else {
      const index = lines[source]!;
      rgba.set(palette!.subarray(index * 3, index * 3 + 3), out);
      rgba[out + 3] = alpha === null ? 255 : (alpha[index] ?? 255);
    }
  }

  return { width: head.width, height: head.height, rgba };
}

/** One scanline byte, past the filter the encoder chose for that line. */
function unfilter(
  filter: number,
  value: number,
  a: number,
  b: number,
  c: number,
): number {
  switch (filter) {
    case 0:
      return value;
    case 1:
      return (value + a) & 0xff;
    case 2:
      return (value + b) & 0xff;
    case 3:
      return (value + ((a + b) >> 1)) & 0xff;
    case 4: {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const near = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      return (value + near) & 0xff;
    }
    default:
      return fail("a PNG scanline filter of 0 to 4", filter);
  }
}

/** Two decoded sprites carry the same pixels. */
export function samePixels(a: Png, b: Png): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.rgba.length; i += 1) {
    if (a.rgba[i] !== b.rgba[i]) return false;
  }
  return true;
}

/** The fraction of a sprite's canvas carrying more alpha than `floor`. */
export function coverage(png: Png, floor: number): number {
  let covered = 0;
  for (let i = 3; i < png.rgba.length; i += 4) {
    if (png.rgba[i]! > floor) covered += 1;
  }
  return covered / (png.width * png.height);
}
