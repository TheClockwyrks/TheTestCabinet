#!/usr/bin/env node
// Generates the DUMMY (but valid) Foray sprite sheet: an indexed-color PNG on a
// 16x16-cell grid, the `sheet.json` atlas, and is kept in sync with `palette.json`.
//
// This is a placeholder the art lead replaces later (assets.md, "Generation &
// review"). It only has to conform to the contract the renderer depends on: the
// 16x16 grid, a power-of-two canvas, indexed color, and the required frame list.
// Each frame is drawn as a simple structured glyph from a small fixed index
// palette; the agent frames use the recolourable slot indices (1..4) so the
// renderer's per-team palette swap (palette.json) lights them up Red or Blue.
//
// Run: `node gen-sheet.mjs` from this directory. Re-run only when the spec or the
// palette changes — `sheet.png`/`sheet.json` are committed artefacts.

import { deflateSync } from "node:zlib";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const CELL = 16;
const COLS = 16; // 16 cells across -> 256px, a power of two.
const ROWS = 16; // 16 cells down  -> 256px.
const W = COLS * CELL;
const H = ROWS * CELL;

// The indexed palette. Index 0 is transparent (alpha 0); the recolourable agent
// slots occupy a fixed, documented block (1..4) so the renderer can rewrite just
// those table entries per team without re-uploading the texture. The shared
// (non-tinted) entries follow. Keep this in lockstep with palette.json's keys.
const palette = JSON.parse(readFileSync(join(here, "palette.json"), "utf8"));

// Fixed index assignments. The first five are the recolourable slots (the
// renderer overwrites 1..4 with the chosen team ramp; index 5 carried_seed is a
// shared gold). Shared tiles/fixtures use their own stable indices after that.
const IDX = {
  transparent: 0,
  body_dark: 1,
  body_mid: 2,
  body_light: 3,
  accent: 4,
  carried_seed: 5,
  soil_dark: 6,
  soil_mid: 7,
  floor: 8,
  border: 9,
  seed: 10,
  jelly: 11,
  jelly_spent: 12,
  outline: 13,
};

// Base RGBA for each palette index. The agent slots are seeded with the *neutral*
// base ramp (a desaturated grey) per assets.md — "authored once in a neutral base
// ramp and tinted Red or Blue at draw time". The renderer swaps these at runtime.
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  255,
];
const PAL = new Array(256).fill(null).map(() => [0, 0, 0, 0]);
PAL[IDX.transparent] = [0, 0, 0, 0];
PAL[IDX.body_dark] = hex("#3a3a3a");
PAL[IDX.body_mid] = hex("#6a6a6a");
PAL[IDX.body_light] = hex("#9a9a9a");
PAL[IDX.accent] = hex("#cccccc");
PAL[IDX.carried_seed] = hex(palette.shared.carried_seed);
PAL[IDX.soil_dark] = hex(palette.shared.soil_dark);
PAL[IDX.soil_mid] = hex(palette.shared.soil_mid);
PAL[IDX.floor] = hex(palette.shared.floor);
PAL[IDX.border] = hex(palette.shared.border);
PAL[IDX.seed] = hex(palette.shared.seed);
PAL[IDX.jelly] = hex(palette.shared.jelly);
PAL[IDX.jelly_spent] = hex(palette.shared.jelly_spent);
PAL[IDX.outline] = hex("#0a0806");

// The pixel buffer (one byte per pixel = a palette index).
const pixels = new Uint8Array(W * H).fill(IDX.transparent);

function put(px, py, idx) {
  if (px < 0 || py < 0 || px >= W || py >= H) return;
  pixels[py * W + px] = idx;
}

// Draw helpers operate in cell-local coordinates (0..15) at a cell origin.
function fillCell(cx, cy, idx) {
  const ox = cx * CELL;
  const oy = cy * CELL;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) put(ox + x, oy + y, idx);
}

function rect(cx, cy, x0, y0, x1, y1, idx) {
  const ox = cx * CELL;
  const oy = cy * CELL;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(ox + x, oy + y, idx);
}

// An agent body glyph: a rounded blob using the recolourable ramp, with a small
// directional notch (a mandible / head marker) so the four facings read apart and
// laden/immune variants get extra marks. `accent` is the head, `body_light` a
// highlight. Facing is decorative (rules are direction-agnostic).
function agentGlyph(cx, cy, facing, opts = {}) {
  // body
  rect(cx, cy, 3, 4, 12, 13, IDX.body_mid);
  rect(cx, cy, 4, 3, 11, 4, IDX.body_mid);
  rect(cx, cy, 4, 13, 11, 14, IDX.body_dark);
  rect(cx, cy, 4, 5, 6, 8, IDX.body_light); // highlight
  // head/accent notch by facing
  if (facing === "n") rect(cx, cy, 6, 1, 9, 3, IDX.accent);
  else if (facing === "s") rect(cx, cy, 6, 14, 9, 15, IDX.accent);
  else if (facing === "e") rect(cx, cy, 12, 6, 14, 9, IDX.accent);
  else if (facing === "w") rect(cx, cy, 1, 6, 3, 9, IDX.accent);
  // soldier = mandibles (two dark prongs up front); raider = leaner (already)
  if (opts.soldier) {
    rect(cx, cy, 4, 2, 5, 3, IDX.body_dark);
    rect(cx, cy, 10, 2, 11, 3, IDX.body_dark);
  }
  // laden = a gold seed lump on the back
  if (opts.laden) rect(cx, cy, 6, 6, 9, 9, IDX.carried_seed);
  // immune overlay handled by its own frame
}

const atlas = { cell: CELL, frames: {} };

let slot = 0;
function place(name, draw) {
  const cx = slot % COLS;
  const cy = Math.floor(slot / COLS);
  draw(cx, cy);
  atlas.frames[name] = { x: cx * CELL, y: cy * CELL, w: CELL, h: CELL };
  slot++;
}

// --- Required frames (assets.md "Required frames") ---------------------------
for (const f of ["n", "s", "e", "w"]) {
  place(`soldier_${f}`, (cx, cy) => agentGlyph(cx, cy, f, { soldier: true }));
}
for (const f of ["n", "s", "e", "w"]) {
  place(`raider_${f}`, (cx, cy) => agentGlyph(cx, cy, f, {}));
}
for (const f of ["n", "s", "e", "w"]) {
  place(`raider_laden_${f}`, (cx, cy) => agentGlyph(cx, cy, f, { laden: true }));
}

// Immune overlay: an additive glint ring, drawn over any agent with immune_ticks>0.
place("immune_glint", (cx, cy) => {
  rect(cx, cy, 1, 1, 14, 1, IDX.accent);
  rect(cx, cy, 1, 14, 14, 14, IDX.accent);
  rect(cx, cy, 1, 1, 1, 14, IDX.accent);
  rect(cx, cy, 14, 1, 14, 14, IDX.accent);
  rect(cx, cy, 7, 0, 8, 1, IDX.jelly);
});

// Seed caches (base + size variants).
place("seed", (cx, cy) => {
  rect(cx, cy, 5, 5, 10, 10, IDX.seed);
  rect(cx, cy, 6, 4, 9, 4, IDX.seed);
});
place("seed_small", (cx, cy) => rect(cx, cy, 6, 6, 9, 9, IDX.seed));
place("seed_large", (cx, cy) => {
  rect(cx, cy, 3, 4, 12, 11, IDX.seed);
  rect(cx, cy, 4, 3, 11, 3, IDX.seed);
  rect(cx, cy, 5, 5, 7, 7, IDX.body_light);
});

// Royal jelly.
place("jelly_active", (cx, cy) => {
  rect(cx, cy, 4, 4, 11, 11, IDX.jelly);
  rect(cx, cy, 6, 6, 9, 9, IDX.accent);
  rect(cx, cy, 7, 2, 8, 3, IDX.jelly);
  rect(cx, cy, 7, 12, 8, 13, IDX.jelly);
});
place("jelly_spent", (cx, cy) => {
  rect(cx, cy, 4, 6, 11, 11, IDX.jelly_spent);
  rect(cx, cy, 5, 5, 10, 5, IDX.jelly_spent);
});

// Tiles.
place("floor", (cx, cy) => {
  fillCell(cx, cy, IDX.floor);
  put(cx * CELL + 4, cy * CELL + 11, IDX.soil_dark);
  put(cx * CELL + 11, cy * CELL + 5, IDX.soil_dark);
});
place("wall", (cx, cy) => {
  fillCell(cx, cy, IDX.soil_mid);
  rect(cx, cy, 0, 0, 15, 1, IDX.soil_dark);
  rect(cx, cy, 0, 0, 1, 15, IDX.soil_dark);
  rect(cx, cy, 0, 14, 15, 15, IDX.soil_dark);
});
place("border", (cx, cy) => {
  fillCell(cx, cy, IDX.border);
  for (let y = 0; y < CELL; y += 4) rect(cx, cy, 6, y, 9, y + 1, IDX.soil_dark);
});

// Nest (one frame, tinted per team at draw time via the agent ramp).
place("nest", (cx, cy) => {
  fillCell(cx, cy, IDX.body_dark);
  rect(cx, cy, 2, 2, 13, 13, IDX.body_mid);
  rect(cx, cy, 5, 5, 10, 10, IDX.floor);
  rect(cx, cy, 6, 6, 9, 9, IDX.accent);
});

// Optional FX.
place("tag_puff", (cx, cy) => {
  rect(cx, cy, 5, 5, 10, 10, IDX.accent);
  rect(cx, cy, 2, 7, 3, 8, IDX.body_light);
  rect(cx, cy, 12, 7, 13, 8, IDX.body_light);
  rect(cx, cy, 7, 2, 8, 3, IDX.body_light);
  rect(cx, cy, 7, 12, 8, 13, IDX.body_light);
});
place("bank_spark", (cx, cy) => {
  rect(cx, cy, 7, 1, 8, 14, IDX.carried_seed);
  rect(cx, cy, 1, 7, 14, 8, IDX.carried_seed);
  rect(cx, cy, 4, 4, 5, 5, IDX.seed);
  rect(cx, cy, 10, 10, 11, 11, IDX.seed);
});

// ---------------------------------------------------------------------------
// Encode an 8-bit indexed (PNG color type 3) PNG with a tRNS chunk for index 0.

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.writeUInt8(8, 8); // bit depth
ihdr.writeUInt8(3, 9); // color type 3 = indexed
ihdr.writeUInt8(0, 10); // compression
ihdr.writeUInt8(0, 11); // filter
ihdr.writeUInt8(0, 12); // interlace

const plte = Buffer.alloc(256 * 3);
const trns = Buffer.alloc(256);
for (let i = 0; i < 256; i++) {
  plte[i * 3] = PAL[i][0];
  plte[i * 3 + 1] = PAL[i][1];
  plte[i * 3 + 2] = PAL[i][2];
  trns[i] = PAL[i][3];
}

// Raw scanlines: each prefixed with filter byte 0.
const raw = Buffer.alloc(H * (W + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W + 1)] = 0;
  pixels.subarray(y * W, y * W + W).forEach((v, x) => {
    raw[y * (W + 1) + 1 + x] = v;
  });
}
const idat = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("PLTE", plte),
  chunk("tRNS", trns),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(join(here, "sheet.png"), png);

// The atlas also publishes the index map so the renderer's palette swap targets
// the right table entries without re-deriving them.
atlas.palette_indices = IDX;
writeFileSync(join(here, "sheet.json"), JSON.stringify(atlas, null, 2) + "\n");

console.log(`wrote sheet.png (${W}x${H}, ${png.length} bytes) and sheet.json (${Object.keys(atlas.frames).length} frames)`);
