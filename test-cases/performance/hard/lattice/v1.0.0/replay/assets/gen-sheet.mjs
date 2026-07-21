#!/usr/bin/env node
// Packs the Lattice sprite sheet the browser playback renderer consumes: an RGBA
// PNG (`sheet.png`) plus its atlas (`sheet.json`).
//
// Unlike Foray's packer, this one does NOT lay frames on a uniform cell grid:
// Lattice's entities are drawn at different sizes (a 16x16 item icon, a 32x32
// belt, a 32x64 splitter, a 64x64 inserter, a 96x96 assembler), so the sheet is
// packed as one ROW PER ENTITY. Each row is as tall as that entity's frame and as
// wide as its frames laid end to end. That keeps the layout deterministic and the
// sheet legible when opened by hand — every row is one entity's animation in order.
//
// Every frame comes from `source/<entity>_<index>.png`, the regenerated output of
// the matching `lattice-*` asset-generation case (see source/README.md). There are
// no placeholders: a missing or wrongly-sized frame is a hard error, because the
// renderer has no art of its own to fall back on and a silently-wrong sheet would
// render a plausible but incorrect factory.
//
// Run: `node gen-sheet.mjs` from this directory. `sheet.png`/`sheet.json` are
// committed artefacts; re-run whenever the source art is re-seeded.

import { deflateSync, inflateSync } from "node:zlib";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(here, "source");

/** The simulation's grid cell, in pixels. Everything registers to this. */
const CELL = 32;

// The placed entities, in sheet row order.
//
// `frames`/`size` mirror each `lattice-*` case's declared sheet length and canvas
// (test-case.toml), and `fps` its declared sequence rate — a mismatch against the
// seeded art is a hard error below, so these stay honest.
//
// `cells`, `offset`, and `rotatable` are RENDERER geometry, and were verified
// against the engine rather than assumed (`World::footprints()` via the playback
// ABI): an assembler anchors at the TOP-LEFT of its 3x3, a splitter covers 1x2
// cells in its canonical east orientation (2x1 when rotated to north/south), and
// an inserter occupies exactly ONE tile despite its 64x64 canvas — its swing arm
// overhangs, so it is drawn centred on its anchor cell with a negative offset.
const ENTITIES = [
  { name: "belt", frames: 8, size: [32, 32], fps: 12, cells: [1, 1], offset: [0, 0], rotatable: true },
  { name: "splitter", frames: 8, size: [32, 64], fps: 12, cells: [1, 2], offset: [0, 0], rotatable: true },
  { name: "inserter", frames: 12, size: [64, 64], fps: 12, cells: [1, 1], offset: [-16, -16], rotatable: true },
  // Non-directional: a symmetric square machine with no facing, so the renderer
  // draws its one sheet as-is and never rotates it.
  { name: "assembler", frames: 8, size: [96, 96], fps: 8, cells: [3, 3], offset: [0, 0], rotatable: false },
  { name: "source", frames: 6, size: [32, 32], fps: 8, cells: [1, 1], offset: [0, 0], rotatable: true },
  { name: "sink", frames: 6, size: [32, 32], fps: 8, cells: [1, 1], offset: [0, 0], rotatable: true },
];

// The belt-item icons. NOT an animation and NOT a placed entity: each frame is one
// item's icon, drawn sub-tile at an item's interpolated position along a lane.
//
// The order is the engine's canonical item table (`lattice_core::prototypes::ITEMS`),
// so a frame index IS the item index carried in a belt's canonical state and the
// renderer needs no lookup table. `ids` is emitted so the renderer can assert that
// correspondence instead of trusting it.
const ITEMS = {
  name: "items",
  size: [16, 16],
  ids: [
    "iron-ore",
    "iron-plate",
    "iron-gear",
    "copper-ore",
    "copper-plate",
    "copper-cable",
    "circuit",
  ],
};

// --- Lay out the sheet: one row per entity, then the item icons --------------

const ROWS = [
  ...ENTITIES.map((e) => ({ ...e, count: e.frames })),
  { ...ITEMS, count: ITEMS.ids.length, fps: null },
];

let W = 0;
let H = 0;
for (const row of ROWS) {
  row.y = H;
  W = Math.max(W, row.size[0] * row.count);
  H += row.size[1];
}

// The packed RGBA buffer (4 bytes/pixel). Writes REPLACE pixels (no compositing),
// so the result is exact and order-independent.
const pixels = new Uint8Array(W * H * 4);

function blit(dx, dy, img) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      const px = dx + x;
      const py = dy + y;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const o = (py * W + px) * 4;
      pixels[o] = img.data[s];
      pixels[o + 1] = img.data[s + 1];
      pixels[o + 2] = img.data[s + 2];
      pixels[o + 3] = img.data[s + 3];
    }
  }
}

// Read, validate, and place one row's frames, returning their atlas rects.
function packRow(row) {
  const [w, h] = row.size;
  const rects = [];
  for (let i = 0; i < row.count; i++) {
    const path = join(SOURCE_DIR, `${row.name}_${i}.png`);
    if (!existsSync(path)) {
      throw new Error(
        `missing source/${row.name}_${i}.png — re-seed this entity's frames from its lattice-${row.name} run`,
      );
    }
    const img = decodePng(readFileSync(path));
    if (img.width !== w || img.height !== h) {
      throw new Error(
        `source/${row.name}_${i}.png is ${img.width}x${img.height}, expected ${w}x${h} ` +
          `(the lattice-${row.name} case's declared canvas)`,
      );
    }
    const x = i * w;
    blit(x, row.y, img);
    rects.push({ x, y: row.y, w, h });
  }
  return rects;
}

const atlas = { cellSize: CELL, sheet: { width: 0, height: 0 }, entities: {}, items: {} };

for (const row of ROWS) {
  const frames = packRow(row);
  if (row.name === ITEMS.name) {
    atlas.items = { frames, ids: ITEMS.ids };
  } else {
    atlas.entities[row.name] = {
      frames,
      fps: row.fps,
      // Every placed entity loops; only the item icons are static.
      loop: true,
      cells: row.cells,
      offset: row.offset,
      rotatable: row.rotatable,
    };
  }
}
atlas.sheet = { width: W, height: H };

// --- Minimal PNG decode (color type 6, 8-bit, non-interlaced) ----------------
// The draw tool always emits RGBA8 PNGs, so we support exactly that and error out
// clearly on anything else rather than carrying a full decoder.

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
    throw new Error(
      `unsupported PNG (colorType ${colorType}, bitDepth ${bitDepth}, interlace ${interlace}); expected RGBA8 non-interlaced`,
    );
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
  raw.set(pixels.subarray(y * W * 4, y * W * 4 + W * 4), y * (W * 4 + 1) + 1);
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

const frameCount =
  Object.values(atlas.entities).reduce((n, e) => n + e.frames.length, 0) +
  atlas.items.frames.length;
console.log(
  `wrote sheet.png (${W}x${H}, ${png.length} bytes) and sheet.json ` +
    `(${frameCount} frames across ${Object.keys(atlas.entities).length} entities + ${atlas.items.frames.length} item icons)`,
);
