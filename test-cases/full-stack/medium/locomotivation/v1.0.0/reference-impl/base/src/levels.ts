// Locomotivation — the six-level campaign, encoded as DATA (specs/levels.md).
//
// Each level is a plain `LevelDef` object: a 32x16 terrain grid (one char per tile,
// per the terrain legend), the placeable elements by tile (col,row), the train
// schedules, the shift clock/lives/quota, and the optional last train. This is exactly
// the data the Balance phase tunes — edit these objects, not the systems in `sim/` or
// `constants.ts`. Every level must remain winnable by skilled play.
//
// Terrain legend (specs/levels.md):
//   '.' Ground (safe)     '=' Track horizontal   '!' Track vertical
//   'B' Bridge            'o' Refuge bay          '~' Gap (impassable)   '#' Wall
//
// NOTE on the maps in specs/levels.md: element markers (dispensers, zones, spawns,
// packages, levers, and Level 2's optional `o`) sit on ordinary safe tiles, so in the
// terrain grids below those tiles are Ground; the elements themselves come from the
// element arrays. A few finale tiles the spec flags as "intent" (Level 6's row-5/6 gap,
// the exact bridge columns) are resolved here into one self-consistent layout for the
// Balance phase to finalize; the firm facts (bridge on T2, refuge coords) are kept.

import { GRID_COLS, GRID_ROWS } from "./constants";
import type { LevelDef } from "./types";

// ─── Terrain-row helpers (kept literal below, but validated at module load) ─────────

const G = "................................"; // 32 Ground
const H = "================================"; // 32 Track (horizontal)

// ─── Level 1 — "First Shift" (tutorial) ─────────────────────────────────────────────

const LEVEL_1: LevelDef = {
  id: 1,
  name: "First Shift",
  terrain: [
    G, // 0
    G, // 1
    G, // 2   Red zone (4,2)
    G, // 3
    G, // 4
    G, // 5
    G, // 6
    G, // 7
    H, // 8   T0 commuter →
    G, // 9
    G, // 10
    G, // 11
    G, // 12
    G, // 13  Red dispenser (3,13)
    G, // 14  Spawn (3,14)
    G, // 15
  ],
  spawn: { col: 3, row: 14 },
  dispensers: [{ id: "d-red", at: { col: 3, row: 13 }, color: "red", weight: "parcel", quota: 3 }],
  dropZones: [{ id: "z-red", at: { col: 4, row: 2 }, color: "red" }],
  uniques: [],
  optionals: [],
  tracks: [{ id: "T0", orientation: "horizontal", line: 8, kind: "commuter", dir: "east", period: 5.0, phase: 1.0 }],
  levers: [],
  signals: [{ id: "s-T0", at: { col: 3, row: 7 }, trackId: "T0" }],
  refuges: [],
  clock: 60,
  lives: 3,
  quota: [{ color: "red", required: 3 }],
};

// ─── Level 2 — "The Yard" (two tracks, two colors) ─────────────────────────────────

const LEVEL_2: LevelDef = {
  id: 2,
  name: "The Yard",
  terrain: [
    G, // 0
    G, // 1   Blue zone (1,1)  Red zone (30,1)
    G, // 2
    G, // 3   Amber zone (15,3)
    G, // 4
    G, // 5
    G, // 6
    H, // 7   T0 commuter →
    G, // 8   safe gap between rails
    H, // 9   T1 freight ←
    G, // 10
    G, // 11
    G, // 12  optional Amber (10,12),(20,12)
    G, // 13  Red disp (3,13)  Blue disp (24,13)
    G, // 14  Spawn (3,14)
    G, // 15
  ],
  spawn: { col: 3, row: 14 },
  dispensers: [
    { id: "d-red", at: { col: 3, row: 13 }, color: "red", weight: "parcel", quota: 3 },
    { id: "d-blue", at: { col: 24, row: 13 }, color: "blue", weight: "parcel", quota: 3 },
  ],
  dropZones: [
    { id: "z-red", at: { col: 30, row: 1 }, color: "red" },
    { id: "z-blue", at: { col: 1, row: 1 }, color: "blue" },
    { id: "z-amber", at: { col: 15, row: 3 }, color: "amber" },
  ],
  uniques: [],
  optionals: [
    { id: "o-amber-a", at: { col: 10, row: 12 }, color: "amber", weight: "parcel" },
    { id: "o-amber-b", at: { col: 20, row: 12 }, color: "amber", weight: "parcel" },
  ],
  tracks: [
    { id: "T0", orientation: "horizontal", line: 7, kind: "commuter", dir: "east", period: 4.5, phase: 0.5 },
    { id: "T1", orientation: "horizontal", line: 9, kind: "freight", dir: "west", period: 8.0, phase: 3.0 },
  ],
  levers: [],
  signals: [
    { id: "s-T0", at: { col: 3, row: 6 }, trackId: "T0" },
    { id: "s-T1", at: { col: 3, row: 10 }, trackId: "T1" },
  ],
  refuges: [],
  clock: 70,
  lives: 3,
  quota: [
    { color: "red", required: 3 },
    { color: "blue", required: 3 },
  ],
};

// ─── Level 3 — "Trestle" (bridges, a unique, the first last train) ─────────────────
// Gap band cols 12-19 spans full height so the two bridges (rows 4 & 11) are the ONLY
// crossings; the four authoritative mid-span refuges override tiles in the band.

const L3_GAP = "............~~~~~~~~............"; // cols 12-19 gap
const L3_R3 = "............~~o~~~~~............"; // refuge (14,3)
const L3_BRA = "............BBBBBBBB............"; // Bridge A (row 4)
const L3_R5 = "............~~~~~o~~............"; // refuge (17,5)
const L3_R10 = "............~~o~~~~~............"; // refuge (14,10)
const L3_BRB = "............BBBBBBBB............"; // Bridge B (row 11)
const L3_R12 = "............~~~~~o~~............"; // refuge (17,12)

const LEVEL_3: LevelDef = {
  id: 3,
  name: "Trestle",
  terrain: [
    L3_GAP, // 0
    L3_GAP, // 1   Red zone (3,1)  Blue zone (28,1)
    L3_GAP, // 2
    L3_R3, //  3   Amber zone (3,3) ; refuge (14,3)
    L3_BRA, // 4   Bridge A — T0 commuter →
    L3_R5, //  5   refuge (17,5)
    L3_GAP, // 6
    L3_GAP, // 7
    L3_GAP, // 8   Spawn (8,8)
    L3_GAP, // 9
    L3_R10, // 10  refuge (14,10)
    L3_BRB, // 11  Bridge B — T1 freight ← (last-train lane)
    L3_R12, // 12  refuge (17,12)
    L3_GAP, // 13  Blue disp (3,13)  Red UNIQUE (28,13)
    L3_GAP, // 14  optional Amber (28,14)
    L3_GAP, // 15
  ],
  spawn: { col: 8, row: 8 },
  dispensers: [{ id: "d-blue", at: { col: 3, row: 13 }, color: "blue", weight: "crate", quota: 3 }],
  dropZones: [
    { id: "z-blue", at: { col: 28, row: 1 }, color: "blue" },
    { id: "z-red", at: { col: 3, row: 1 }, color: "red" },
    { id: "z-amber", at: { col: 3, row: 3 }, color: "amber" },
  ],
  uniques: [{ id: "u-red", at: { col: 28, row: 13 }, color: "red", weight: "load" }],
  optionals: [{ id: "o-amber", at: { col: 28, row: 14 }, color: "amber", weight: "parcel" }],
  tracks: [
    { id: "T0", orientation: "horizontal", line: 4, kind: "commuter", dir: "east", period: 7.0, phase: 1.0 },
    { id: "T1", orientation: "horizontal", line: 11, kind: "freight", dir: "west", period: 9.0, phase: 4.0 },
  ],
  levers: [],
  signals: [
    { id: "s-T0", at: { col: 11, row: 3 }, trackId: "T0" },
    { id: "s-T1", at: { col: 11, row: 10 }, trackId: "T1" },
  ],
  refuges: [
    { col: 14, row: 3 },
    { col: 17, row: 5 },
    { col: 14, row: 10 },
    { col: 17, row: 12 },
  ],
  clock: 110,
  lives: 3,
  quota: [
    { color: "red", required: 1 },
    { color: "blue", required: 3 },
  ],
  // Last train on the Bridge B lane (row 11), ← , freight speed; its tail clears the map
  // exactly as the clock ends (spawn derived at runtime). Rideable flat-tops interspersed.
  lastTrain: {
    orientation: "horizontal",
    line: 11,
    dir: "west",
    kind: "freight",
    consist: ["engine", "boxcar", "flat-top", "boxcar", "flat-top-half", "flat-top"],
  },
};

// ─── Level 4 — "Interchange" (a bullet, a switch, two uniques) ─────────────────────
// Row 6 is a dormant siding for the bullet (T1): Ground until the lever diverts the
// bullet onto it, at which point row 6 goes live and row 5 dormant.

const LEVEL_4: LevelDef = {
  id: 4,
  name: "Interchange",
  terrain: [
    G, // 0
    G, // 1   Red(1,1) Green(12,1) Blue(27,1)
    G, // 2
    H, // 3   T0 commuter → (lever L at 14,3)
    G, // 4   safe gap
    H, // 5   T1 bullet ← (switchable to row 6)
    G, // 6   dormant siding (T1s) — Ground until switched
    G, // 7
    G, // 8   Spawn (16,8)
    G, // 9
    H, // 10  T2 freight →
    G, // 11
    G, // 12  Blue disp (3,12)  Red unique (11,12)  Green unique (22,12)
    G, // 13  optional Amber (11,13),(18,13)
    G, // 14
    G, // 15  Amber zone (15,15)
  ],
  spawn: { col: 16, row: 8 },
  dispensers: [{ id: "d-blue", at: { col: 3, row: 12 }, color: "blue", weight: "crate", quota: 3 }],
  dropZones: [
    { id: "z-red", at: { col: 1, row: 1 }, color: "red" },
    { id: "z-green", at: { col: 12, row: 1 }, color: "green" },
    { id: "z-blue", at: { col: 27, row: 1 }, color: "blue" },
    { id: "z-amber", at: { col: 15, row: 15 }, color: "amber" },
  ],
  uniques: [
    { id: "u-red", at: { col: 11, row: 12 }, color: "red", weight: "crate" },
    { id: "u-green", at: { col: 22, row: 12 }, color: "green", weight: "load" },
  ],
  optionals: [
    { id: "o-amber-a", at: { col: 11, row: 13 }, color: "amber", weight: "parcel" },
    { id: "o-amber-b", at: { col: 18, row: 13 }, color: "amber", weight: "parcel" },
  ],
  tracks: [
    { id: "T0", orientation: "horizontal", line: 3, kind: "commuter", dir: "east", period: 4.0, phase: 0.5 },
    {
      id: "T1",
      orientation: "horizontal",
      line: 5,
      kind: "bullet",
      dir: "west",
      period: 3.5,
      phase: 2.0,
      sidingLine: 6,
      leverId: "L1",
    },
    { id: "T2", orientation: "horizontal", line: 10, kind: "freight", dir: "east", period: 8.5, phase: 1.5 },
  ],
  levers: [{ id: "L1", at: { col: 14, row: 3 }, trackId: "T1" }],
  signals: [
    { id: "s-T0", at: { col: 16, row: 2 }, trackId: "T0" },
    { id: "s-T1", at: { col: 16, row: 7 }, trackId: "T1" },
    { id: "s-T2", at: { col: 16, row: 9 }, trackId: "T2" },
  ],
  refuges: [],
  clock: 118,
  lives: 3,
  quota: [
    { color: "red", required: 1 },
    { color: "green", required: 1 },
    { color: "blue", required: 3 },
  ],
  // Last train on T2 (row 10), → , freight consist with flat-tops.
  lastTrain: {
    orientation: "horizontal",
    line: 10,
    dir: "east",
    kind: "freight",
    consist: ["engine", "boxcar", "flat-top", "boxcar", "flat-top-half", "flat-top"],
  },
};

// ─── Level 5 — "Rush Hour" (all three kinds, tight) ─────────────────────────────────
// T0 does not reach the right edge (cols 0-29); the lever diverts T1 (freight) between
// row 4 (default) and a row-3 siding.

const L5_T0 = "==============================.."; // 30 track + 2 ground (cols 0-29)

const LEVEL_5: LevelDef = {
  id: 5,
  name: "Rush Hour",
  terrain: [
    G, //     0
    G, //     1   Red(1,1) Green(22,1)
    L5_T0, // 2   T0 commuter →
    G, //     3   (row-3 siding for T1 when switched)
    H, //     4   T1 freight ← (lever L at 6,4)
    G, //     5
    G, //     6   Spawn (16,6)
    H, //     7   T2 bullet →
    G, //     8
    G, //     9   Blue zone (2,9)  Amber zone (29,9)
    G, //     10
    H, //     11  T3 commuter ←
    G, //     12
    G, //     13  disps + uniques + optional
    G, //     14
    G, //     15
  ],
  spawn: { col: 16, row: 6 },
  dispensers: [
    { id: "d-blue", at: { col: 3, row: 13 }, color: "blue", weight: "parcel", quota: 3 },
    { id: "d-green", at: { col: 9, row: 13 }, color: "green", weight: "crate", quota: 2 },
  ],
  dropZones: [
    { id: "z-red", at: { col: 1, row: 1 }, color: "red" },
    { id: "z-green", at: { col: 22, row: 1 }, color: "green" },
    { id: "z-blue", at: { col: 2, row: 9 }, color: "blue" },
    { id: "z-amber", at: { col: 29, row: 9 }, color: "amber" },
  ],
  uniques: [
    { id: "u-red", at: { col: 15, row: 13 }, color: "red", weight: "load" },
    { id: "u-green", at: { col: 23, row: 13 }, color: "green", weight: "load" },
  ],
  optionals: [{ id: "o-amber", at: { col: 27, row: 13 }, color: "amber", weight: "parcel" }],
  tracks: [
    { id: "T0", orientation: "horizontal", line: 2, kind: "commuter", dir: "east", period: 4.0, phase: 0.0 },
    {
      id: "T1",
      orientation: "horizontal",
      line: 4,
      kind: "freight",
      dir: "west",
      period: 8.0,
      phase: 2.0,
      sidingLine: 3,
      leverId: "L1",
    },
    { id: "T2", orientation: "horizontal", line: 7, kind: "bullet", dir: "east", period: 3.0, phase: 1.0 },
    { id: "T3", orientation: "horizontal", line: 11, kind: "commuter", dir: "west", period: 4.5, phase: 2.5 },
  ],
  levers: [{ id: "L1", at: { col: 6, row: 4 }, trackId: "T1" }],
  signals: [
    { id: "s-T0", at: { col: 16, row: 1 }, trackId: "T0" },
    { id: "s-T1", at: { col: 16, row: 5 }, trackId: "T1" },
    { id: "s-T2", at: { col: 16, row: 8 }, trackId: "T2" },
    { id: "s-T3", at: { col: 16, row: 12 }, trackId: "T3" },
  ],
  refuges: [],
  clock: 80,
  lives: 3,
  quota: [
    { color: "red", required: 1 },
    { color: "green", required: 3 }, // 1 unique + 2 dispenser
    { color: "blue", required: 3 },
  ],
  // Last train on T3 (row 11), ← , commuter speed — a faster, tighter board.
  lastTrain: {
    orientation: "horizontal",
    line: 11,
    dir: "west",
    kind: "commuter",
    consist: ["engine", "flat-top", "flat-top-half", "flat-top"],
  },
};

// ─── Level 6 — "Last Train Out" (finale) ────────────────────────────────────────────
// The finale's lower third is a gap band (cols 11-17 and 21-27) crossed by the T2
// freight BRIDGE (row 10, cols 18-22) with two refuge bays; the top T1 commuter lane is
// kept clean here (the spec flagged its row-5/6 gap as "intent"). Balance may re-add it.

const L6_T0 = "==============================.."; // 30 track + 2 ground (cols 0-29)
const L6_R9 = "...................o............"; // refuge (19,9)
const L6_T2 = "==================BBBBB========="; // T2 with bridge cols 18-22
const L6_R11 = "...........~~~~~~~...o~~~~~~...."; // gap bands + refuge (21,11)
const L6_G12 = "...........~~~~~~~...~~~~~~~...."; // gap bands flanking the bridge

const LEVEL_6: LevelDef = {
  id: 6,
  name: "Last Train Out",
  terrain: [
    G, //     0
    G, //     1   Red(1,1) Green(10,1) Blue(21,1)
    L6_T0, // 2   T0 bullet →
    G, //     3
    G, //     4   (row-4 siding for T1 when switched; lever L at 6,4)
    H, //     5   T1 commuter ←
    G, //     6
    G, //     7
    G, //     8   Spawn (8,8)
    L6_R9, // 9   refuge (19,9) beside the bridge
    L6_T2, // 10  T2 freight → with BRIDGE (cols 18-22)
    L6_R11, // 11 gap bands + refuge (21,11)
    L6_G12, // 12 gap bands ; Blue zone (2,12)
    G, //     13  disps + uniques + Amber zone (31,13)
    G, //     14  optional Amber (11,14),(16,14),(21,14)
    G, //     15
  ],
  spawn: { col: 8, row: 8 },
  dispensers: [
    { id: "d-blue", at: { col: 3, row: 13 }, color: "blue", weight: "parcel", quota: 2 },
    { id: "d-green", at: { col: 6, row: 13 }, color: "green", weight: "crate", quota: 1 },
  ],
  dropZones: [
    { id: "z-red", at: { col: 1, row: 1 }, color: "red" },
    { id: "z-green", at: { col: 10, row: 1 }, color: "green" },
    { id: "z-blue-top", at: { col: 21, row: 1 }, color: "blue" },
    { id: "z-blue-low", at: { col: 2, row: 12 }, color: "blue" },
    { id: "z-amber", at: { col: 31, row: 13 }, color: "amber" },
  ],
  uniques: [
    { id: "u-green", at: { col: 15, row: 13 }, color: "green", weight: "load" },
    { id: "u-red", at: { col: 19, row: 13 }, color: "red", weight: "load" },
    { id: "u-blue", at: { col: 23, row: 13 }, color: "blue", weight: "crate" },
  ],
  optionals: [
    { id: "o-amber-a", at: { col: 11, row: 14 }, color: "amber", weight: "parcel" },
    { id: "o-amber-b", at: { col: 16, row: 14 }, color: "amber", weight: "parcel" },
    { id: "o-amber-c", at: { col: 21, row: 14 }, color: "amber", weight: "parcel" },
  ],
  tracks: [
    { id: "T0", orientation: "horizontal", line: 2, kind: "bullet", dir: "east", period: 3.0, phase: 0.0 },
    {
      id: "T1",
      orientation: "horizontal",
      line: 5,
      kind: "commuter",
      dir: "west",
      period: 4.0,
      phase: 1.0,
      sidingLine: 4,
      leverId: "L1",
    },
    { id: "T2", orientation: "horizontal", line: 10, kind: "freight", dir: "east", period: 9.0, phase: 3.0 },
  ],
  levers: [{ id: "L1", at: { col: 6, row: 4 }, trackId: "T1" }],
  signals: [
    { id: "s-T0", at: { col: 16, row: 1 }, trackId: "T0" },
    { id: "s-T1", at: { col: 16, row: 7 }, trackId: "T1" },
    { id: "s-T2", at: { col: 8, row: 9 }, trackId: "T2" },
  ],
  refuges: [
    { col: 19, row: 9 },
    { col: 21, row: 11 },
  ],
  clock: 64,
  lives: 3,
  quota: [
    { color: "red", required: 1 },
    { color: "green", required: 2 }, // 1 unique + 1 dispenser
    { color: "blue", required: 3 }, // 1 unique + 2 dispenser
  ],
  // The long freight last train on T2 (row 10), → , rich in flat-tops (the capstone).
  lastTrain: {
    orientation: "horizontal",
    line: 10,
    dir: "east",
    kind: "freight",
    consist: ["engine", "flat-top", "boxcar", "flat-top", "flat-top-half", "flat-top"],
  },
};

// ─── The campaign, in play order ────────────────────────────────────────────────────

export const LEVELS: LevelDef[] = [LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, LEVEL_5, LEVEL_6];

// ─── Dimension guard — fail loud on a mis-transcribed grid ──────────────────────────
// Runs once at import. Any level whose terrain is not exactly GRID_ROWS x GRID_COLS
// throws immediately, so a bad edit is caught at load (game and headless harness alike).
for (const lvl of LEVELS) {
  if (lvl.terrain.length !== GRID_ROWS) {
    throw new Error(`Level ${lvl.id} "${lvl.name}": expected ${GRID_ROWS} rows, got ${lvl.terrain.length}`);
  }
  lvl.terrain.forEach((row, r) => {
    if (row.length !== GRID_COLS) {
      throw new Error(
        `Level ${lvl.id} "${lvl.name}" row ${r}: expected ${GRID_COLS} cols, got ${row.length} ("${row}")`,
      );
    }
  });
}
