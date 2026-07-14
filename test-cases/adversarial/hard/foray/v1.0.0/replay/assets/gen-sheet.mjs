#!/usr/bin/env node
// Packs the Foray sprite sheet the browser replay renderer consumes: an RGBA PNG
// on a 16x16-cell grid (`sheet.png`) plus its atlas (`sheet.json`), kept in sync
// with `palette.json`.
//
// This is a *composer*, not just a dummy generator. For each named frame it
// FIRST looks for finished pixel art under `source/<name>.png` (the regenerated
// output of the matching `foray-*` asset-generation case, committed there — see
// source/README.md) and blits it in; only when no source art exists does it draw
// a structured PLACEHOLDER glyph so the renderer is fully demonstrable today. As
// each `foray-*` case is generated, drop its frames into `source/` under the
// names below and re-run this — finished and placeholder frames coexist in one
// sheet, and a regeneration shows up as an ordinary diff.
//
// Frame names the packer reads from source/ (others are placeholder until then):
//   nest, seed, jelly_active, jelly_spent                      (committed today)
//   soldier_{s,n,w,e}_{0..3}                                   (foray-soldier)
//   raider_{s,n,w,e}_{0..3}, raider_laden_{s,n,w,e}_{0..3}     (foray-raider)
//   wall_{0..15}, border_{cap_top,mid,cap_bottom}, floor       (foray-walls)
//
// The renderer tints the recolorable agent/nest art by matching the neutral grey
// ramp's RGB values at draw time (renderer.mjs:loadSheet) — so the sheet is plain
// RGBA (color type 6); it does NOT need to be indexed-color. Shared art
// (seeds/jelly/soil tiles) deliberately avoids the four neutral greys, so the
// per-team swap leaves it untouched.
//
// Run: `node gen-sheet.mjs` from this directory. `sheet.png`/`sheet.json` are
// committed artefacts; re-run only when the spec, palette, or source art changes.

import { deflateSync, inflateSync } from "node:zlib";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(here, "source");

const CELL = 16;
const COLS = 16; // 16 cells across -> 256px wide.

const palette = JSON.parse(readFileSync(join(here, "palette.json"), "utf8"));

// Named RGBA colors. The agent/nest art uses the *neutral* recolorable ramp
// (body_dark/mid/light, accent) the renderer swaps per team; everything else uses
// the shared (never-tinted) palette. Keep the neutral greys in lockstep with
// renderer.mjs's NEUTRAL map.
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  255,
];
const COL = {
  transparent: [0, 0, 0, 0],
  body_dark: hex("#3a3a3a"),
  body_mid: hex("#6a6a6a"),
  body_light: hex("#9a9a9a"),
  accent: hex("#cccccc"),
  carried_seed: hex(palette.shared.carried_seed),
  soil_dark: hex(palette.shared.soil_dark),
  soil_mid: hex(palette.shared.soil_mid),
  floor: hex(palette.shared.floor),
  border: hex(palette.shared.border),
  seed: hex(palette.shared.seed),
  jelly: hex(palette.shared.jelly),
  jelly_spent: hex(palette.shared.jelly_spent),
  outline: hex("#0a0806"),
};

// --- Frame plan -------------------------------------------------------------
// Order is just sheet layout; the renderer addresses frames by NAME via the
// atlas (frames / anims / wall_tiles / border_tiles), never by position.

const FACINGS = ["s", "n", "w", "e"];
const STEPS = [0, 1, 2, 3]; // a 4-pose walk cycle per facing.

// We size the canvas to fit every planned frame on the 16-wide grid.
const FRAME_PLAN = [];
for (const f of FACINGS) for (const i of STEPS) FRAME_PLAN.push(`soldier_${f}_${i}`);
for (const f of FACINGS) for (const i of STEPS) FRAME_PLAN.push(`raider_${f}_${i}`);
for (const f of FACINGS) for (const i of STEPS) FRAME_PLAN.push(`raider_laden_${f}_${i}`);
// Note: the immune (royal-jelly) aura is NOT a sheet frame — the renderer draws
// it procedurally as a breathing additive glow over an immune agent.
FRAME_PLAN.push("seed", "large_seed", "jelly_active", "jelly_spent", "nest");
for (let m = 0; m < 16; m++) FRAME_PLAN.push(`wall_${m}`);
FRAME_PLAN.push("border_cap_top", "border_mid", "border_cap_bottom", "floor");

const ROWS = Math.ceil(FRAME_PLAN.length / COLS);
const W = COLS * CELL;
const H = ROWS * CELL;

// The packed RGBA buffer (4 bytes/pixel). Operations REPLACE pixels (no alpha
// compositing) so the result is exact and order-independent within a frame.
const pixels = new Uint8Array(W * H * 4);

function put(px, py, col) {
  if (px < 0 || py < 0 || px >= W || py >= H) return;
  const o = (py * W + px) * 4;
  pixels[o] = col[0];
  pixels[o + 1] = col[1];
  pixels[o + 2] = col[2];
  pixels[o + 3] = col[3];
}

// Cell-local draw helpers (coordinates 0..15 within the cell at origin cx,cy).
function fillCell(cx, cy, col) {
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) put(cx * CELL + x, cy * CELL + y, col);
}
function rect(cx, cy, x0, y0, x1, y1, col) {
  const ox = cx * CELL;
  const oy = cy * CELL;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(ox + x, oy + y, col);
}

// Blit a decoded 16x16 RGBA source image into the cell at cx,cy.
function blit(cx, cy, img) {
  const ox = cx * CELL;
  const oy = cy * CELL;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const s = (y * img.width + x) * 4;
      put(ox + x, oy + y, [img.data[s], img.data[s + 1], img.data[s + 2], img.data[s + 3]]);
    }
  }
}

// --- Placeholder glyphs (only drawn when source/<name>.png is absent) --------

// An agent body glyph with a 4-step walk bob so motion is visible in playback.
// `step` 0..3: a small vertical bob plus alternating "legs". Facing adds a
// leading accent notch; soldier gets mandibles; laden gets a gold seed lump.
function agentGlyph(cx, cy, facing, step, opts = {}) {
  const bob = step === 1 ? -1 : step === 3 ? 1 : 0; // body lift on passing poses
  const t = (y) => y + bob;
  rect(cx, cy, 3, t(4), 12, t(13), COL.body_mid);
  rect(cx, cy, 4, t(3), 11, t(4), COL.body_mid);
  rect(cx, cy, 4, t(13), 11, t(14), COL.body_dark);
  rect(cx, cy, 4, t(5), 6, t(8), COL.body_light); // highlight
  // alternating legs (a couple of dark pixels that swap sides each step)
  if (step % 2 === 0) {
    put(cx * CELL + 5, cy * CELL + t(15), COL.body_dark);
    put(cx * CELL + 10, cy * CELL + t(14), COL.body_dark);
  } else {
    put(cx * CELL + 5, cy * CELL + t(14), COL.body_dark);
    put(cx * CELL + 10, cy * CELL + t(15), COL.body_dark);
  }
  // leading accent notch by facing
  if (facing === "n") rect(cx, cy, 6, t(1), 9, t(3), COL.accent);
  else if (facing === "s") rect(cx, cy, 6, t(14), 9, t(15), COL.accent);
  else if (facing === "e") rect(cx, cy, 12, t(6), 14, t(9), COL.accent);
  else if (facing === "w") rect(cx, cy, 1, t(6), 3, t(9), COL.accent);
  if (opts.soldier) {
    rect(cx, cy, 4, t(2), 5, t(3), COL.body_dark);
    rect(cx, cy, 10, t(2), 11, t(3), COL.body_dark);
  }
  if (opts.laden) rect(cx, cy, 6, t(6), 9, t(9), COL.carried_seed);
}

// A pac-man-style maze wall autotile placeholder, selected by a 4-neighbor
// bitmask: N=1, E=2, S=4, W=8 (a set bit means that neighbor is also a wall, so
// the corridor connects that way). Connected sides extend to the cell edge so
// adjacent walls merge; unconnected sides get a dark cap rim.
function wallGlyph(cx, cy, mask) {
  rect(cx, cy, 3, 3, 12, 12, COL.soil_mid); // core block
  if (mask & 1) rect(cx, cy, 3, 0, 12, 3, COL.soil_mid); // N
  if (mask & 2) rect(cx, cy, 12, 3, 15, 12, COL.soil_mid); // E
  if (mask & 4) rect(cx, cy, 3, 12, 12, 15, COL.soil_mid); // S
  if (mask & 8) rect(cx, cy, 0, 3, 3, 12, COL.soil_mid); // W
  // dark cap rims on the unconnected sides
  if (!(mask & 1)) rect(cx, cy, 3, 3, 12, 3, COL.soil_dark);
  if (!(mask & 2)) rect(cx, cy, 12, 3, 12, 12, COL.soil_dark);
  if (!(mask & 4)) rect(cx, cy, 3, 12, 12, 12, COL.soil_dark);
  if (!(mask & 8)) rect(cx, cy, 3, 3, 3, 12, COL.soil_dark);
  rect(cx, cy, 4, 4, 5, 5, COL.body_light); // faint top-left highlight (shared grey, not tinted)
}

const PLACEHOLDER = {
  seed: (cx, cy) => {
    rect(cx, cy, 5, 5, 10, 10, COL.seed);
    rect(cx, cy, 6, 4, 9, 4, COL.seed);
  },
  // The large seed reads as the ordinary seed's big sibling: the same seed colour,
  // filling most of the cell, with an outline so it stays legible against the floor
  // and a bright core so it is obvious at a glance which of the two you are looking
  // at. It is worth three ordinary seeds and it MOVES, so it has to be the thing the
  // eye lands on first.
  large_seed: (cx, cy) => {
    rect(cx, cy, 3, 3, 12, 12, COL.outline);
    rect(cx, cy, 4, 4, 11, 11, COL.seed);
    rect(cx, cy, 6, 6, 9, 9, COL.accent);
    rect(cx, cy, 5, 2, 10, 2, COL.seed);
    rect(cx, cy, 5, 13, 10, 13, COL.seed);
  },
  jelly_active: (cx, cy) => {
    rect(cx, cy, 4, 4, 11, 11, COL.jelly);
    rect(cx, cy, 6, 6, 9, 9, COL.accent);
    rect(cx, cy, 7, 2, 8, 3, COL.jelly);
    rect(cx, cy, 7, 12, 8, 13, COL.jelly);
  },
  jelly_spent: (cx, cy) => {
    rect(cx, cy, 4, 6, 11, 11, COL.jelly_spent);
    rect(cx, cy, 5, 5, 10, 5, COL.jelly_spent);
  },
  nest: (cx, cy) => {
    fillCell(cx, cy, COL.body_dark);
    rect(cx, cy, 2, 2, 13, 13, COL.body_mid);
    rect(cx, cy, 5, 5, 10, 10, COL.floor);
    rect(cx, cy, 6, 6, 9, 9, COL.accent);
  },
  floor: (cx, cy) => {
    fillCell(cx, cy, COL.floor);
    put(cx * CELL + 4, cy * CELL + 11, COL.soil_dark);
    put(cx * CELL + 11, cy * CELL + 5, COL.soil_dark);
  },
  border_cap_top: (cx, cy) => borderBar(cx, cy, 4, 15),
  border_mid: (cx, cy) => borderBar(cx, cy, 0, 15),
  border_cap_bottom: (cx, cy) => borderBar(cx, cy, 0, 11),
};
function borderBar(cx, cy, y0, y1) {
  fillCell(cx, cy, COL.floor);
  rect(cx, cy, 7, y0, 8, y1, COL.border);
  for (let y = y0 + 1; y <= y1; y += 3) rect(cx, cy, 7, y, 8, y, COL.soil_dark);
}

function placeholderFor(name) {
  if (name.startsWith("soldier_")) {
    const [, f, i] = name.split("_");
    return (cx, cy) => agentGlyph(cx, cy, f, Number(i), { soldier: true });
  }
  if (name.startsWith("raider_laden_")) {
    const [, , f, i] = name.split("_");
    return (cx, cy) => agentGlyph(cx, cy, f, Number(i), { laden: true });
  }
  if (name.startsWith("raider_")) {
    const [, f, i] = name.split("_");
    return (cx, cy) => agentGlyph(cx, cy, f, Number(i), {});
  }
  if (name.startsWith("wall_")) {
    const mask = Number(name.slice(5));
    return (cx, cy) => wallGlyph(cx, cy, mask);
  }
  return PLACEHOLDER[name] || ((cx, cy) => rect(cx, cy, 6, 6, 9, 9, COL.outline));
}

// --- Place every planned frame: source art if present, else placeholder ------

const atlas = { cell: CELL, frames: {} };
let usedSource = 0;
let usedPlaceholder = 0;

FRAME_PLAN.forEach((name, slot) => {
  const cx = slot % COLS;
  const cy = Math.floor(slot / COLS);
  const srcPath = join(SOURCE_DIR, `${name}.png`);
  if (existsSync(srcPath)) {
    const img = decodePng(readFileSync(srcPath));
    if (img.width !== CELL || img.height !== CELL) {
      throw new Error(`source/${name}.png is ${img.width}x${img.height}, expected ${CELL}x${CELL}`);
    }
    blit(cx, cy, img);
    usedSource++;
  } else {
    placeholderFor(name)(cx, cy);
    usedPlaceholder++;
  }
  atlas.frames[name] = { x: cx * CELL, y: cy * CELL, w: CELL, h: CELL };
});

// Walk-cycle animations: one ordered sequence per role+facing the renderer plays
// as an agent crosses a cell. fps is advisory; the renderer ties the phase to
// motion (a frame per quarter-cell), falling back to fps when timing freely.
const WALK_FPS = 8;
atlas.anims = {};
for (const f of FACINGS) {
  atlas.anims[`soldier_walk_${f}`] = { frames: STEPS.map((i) => `soldier_${f}_${i}`), fps: WALK_FPS };
  atlas.anims[`raider_walk_${f}`] = { frames: STEPS.map((i) => `raider_${f}_${i}`), fps: WALK_FPS };
  atlas.anims[`raider_laden_walk_${f}`] = { frames: STEPS.map((i) => `raider_laden_${f}_${i}`), fps: WALK_FPS };
}

// Wall autotile map: 4-neighbor bitmask (N=1,E=2,S=4,W=8) -> frame name.
atlas.wall_tiles = {};
for (let m = 0; m < 16; m++) atlas.wall_tiles[m] = `wall_${m}`;

// No-man's-land border seam: a vertical divider with rounded caps.
atlas.border_tiles = {
  cap_top: "border_cap_top",
  mid: "border_mid",
  cap_bottom: "border_cap_bottom",
};

// --- Minimal PNG decode (color type 6, 8-bit, non-interlaced) ----------------
// The draw tool always emits RGBA8 PNGs, so we support exactly that and error
// out clearly on anything else rather than carrying a full decoder.

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  let pos = 8; // skip the 8-byte signature
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len; // length + type + data + crc
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (colorType !== 6 || bitDepth !== 8 || interlace !== 0) {
    throw new Error(`unsupported PNG (colorType ${colorType}, bitDepth ${bitDepth}, interlace ${interlace}); expected RGBA8 non-interlaced`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4; // bytes per row, excluding the per-row filter byte
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let v = raw[p++];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      cur[x] = v;
    }
    out.set(cur, y * stride);
    prev = cur;
  }
  return { width, height, data: out };
}

// --- Encode an 8-bit RGBA (PNG color type 6) PNG ----------------------------

function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.writeUInt8(8, 8); // bit depth
ihdr.writeUInt8(6, 9); // color type 6 = RGBA
// compression / filter / interlace = 0

// Raw scanlines: each prefixed with filter byte 0, then W*4 RGBA bytes.
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  pixels.subarray(y * W * 4, y * W * 4 + W * 4).forEach((v, i) => {
    raw[y * (W * 4 + 1) + 1 + i] = v;
  });
}
const idat = deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(join(here, "sheet.png"), png);
writeFileSync(join(here, "sheet.json"), JSON.stringify(atlas, null, 2) + "\n");

console.log(
  `wrote sheet.png (${W}x${H}, ${png.length} bytes) and sheet.json ` +
    `(${Object.keys(atlas.frames).length} frames: ${usedSource} from source/, ${usedPlaceholder} placeholder)`,
);
