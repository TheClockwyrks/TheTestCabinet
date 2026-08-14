// Spectra — wave composition (specs/drones.md "What a wave is made of",
// specs/playfield.md formation, specs/gameplay.md challenge stages).
//
// A standard wave's formation is mirror-symmetric about x=640, mixes both bands,
// contains Shards of both bands as the bulk, at least two Fluxes and at least one
// Prism (more in later stages), and grows toward the 9x5 slot capacity with the
// stage. Drones are not present at the start — each is an "entrant" released in
// staggered groups and flown in along a designed entrance path.

import {
  CYAN,
  ENTER_GROUP_GAP,
  MAGENTA,
  opposite,
  slotX,
  slotY,
  type Band,
} from "./constants";
import { smoothPath, type Vec2 } from "./paths";
import type { Drone, DroneKind } from "./types";

export interface Entrant {
  drone: Drone;
  releaseAt: number; // seconds into the wave the drone launches its entrance
}

interface SlotSpec {
  col: number;
  row: number;
  kind: DroneKind;
  band: Band;
  shellBand?: Band;
}

function clampX(x: number): number {
  return Math.max(40, Math.min(1240, x));
}

// A curved swoop from off-screen above the field down into the slot. Half enter
// sweeping in from one side, half from the other, for a readable assembling look.
function entrancePath(sx: number, sy: number, fromLeft: boolean) {
  const side = fromLeft ? -1 : 1;
  const knots: Vec2[] = [
    { x: clampX(sx + side * 300), y: -60 },
    { x: clampX(sx + side * 180), y: 120 },
    { x: clampX(sx - side * 90), y: sy - 40 },
    { x: sx, y: sy },
  ];
  return smoothPath(knots);
}

function makeDrone(spec: SlotSpec, fromLeft: boolean, rng: () => number): Drone {
  const sx = slotX(spec.col);
  const sy = slotY(spec.row);
  const shellBand = spec.shellBand ?? spec.band;
  const coreBand = opposite(shellBand);
  return {
    id: 0, // the Game assigns the real id when it takes ownership
    kind: spec.kind,
    band: spec.kind === "prism" ? shellBand : spec.band,
    x: clampX(sx + (fromLeft ? -300 : 300)),
    y: -60,
    prevX: clampX(sx + (fromLeft ? -300 : 300)),
    prevY: -60,
    col: spec.col,
    row: spec.row,
    slotX: sx,
    slotY: sy,
    phase: "entering",
    angle: 0,
    dead: false,
    path: entrancePath(sx, sy, fromLeft),
    pathDist: 0,
    fireAt: [],
    fluxBase: spec.band,
    fluxClock: spec.kind === "flux" ? rng() * 2 : 0,
    shimmer: false,
    shellBand,
    coreBand,
    shellAlive: spec.kind === "prism",
    invertedThisDive: false,
  };
}

// Build the filled formation slots for a stage.
function buildSlots(stage: number): SlotSpec[] {
  const colsUsed = Math.min(9, 5 + 2 * Math.floor((stage - 1) / 2)); // 5,5,7,7,9,...
  const rowsUsed = Math.min(5, 3 + Math.floor((stage - 1) / 2)); // 3,3,4,4,5,...
  const half = (colsUsed - 1) / 2;
  const cols: number[] = [];
  for (let c = 4 - half; c <= 4 + half; c++) cols.push(c);

  const prismCount = Math.min(3, 1 + Math.floor((stage - 1) / 4));
  const fluxTarget = Math.min(6, 2 + 2 * Math.floor((stage - 1) / 3)); // 2,2,2,4,...

  const filled = new Map<string, SlotSpec>();
  const key = (c: number, r: number) => `${c},${r}`;

  // Prisms across the top row, centered and symmetric.
  const prismCols: number[] = [];
  if (prismCount >= 1) prismCols.push(4);
  if (prismCount >= 2) prismCols.push(4 - 2, 4 + 2);
  for (let i = 0; i < prismCount && i < prismCols.length; i++) {
    const c = prismCols[i]!;
    // Shell band alternates so the top row reads both bands at a glance.
    const shellBand: Band = i % 2 === 0 ? CYAN : MAGENTA;
    filled.set(key(c, 0), { col: c, row: 0, kind: "prism", band: shellBand, shellBand });
  }

  // Fluxes: symmetric pairs on row 1, working outward from center.
  const fluxColsOrder = [4 - 2, 4 + 2, 4 - 3, 4 + 3, 4 - 1, 4 + 1];
  let placedFlux = 0;
  for (const c of fluxColsOrder) {
    if (placedFlux >= fluxTarget) break;
    if (!cols.includes(c)) continue;
    if (filled.has(key(c, 1))) continue;
    const band: Band = c < 4 ? CYAN : MAGENTA;
    filled.set(key(c, 1), { col: c, row: 1, kind: "flux", band });
    placedFlux++;
  }

  // Fill the remaining slots with Shards, checkerboarding the band so both bands
  // are always present and the pattern is mirror-symmetric about x=640.
  for (let r = 0; r < rowsUsed; r++) {
    for (const c of cols) {
      if (filled.has(key(c, r))) continue;
      const band: Band = (c + r) % 2 === 0 ? CYAN : MAGENTA;
      filled.set(key(c, r), { col: c, row: r, kind: "shard", band });
    }
  }

  return [...filled.values()];
}

export function buildWave(stage: number, rng: () => number): Entrant[] {
  const slots = buildSlots(stage);
  const byKey = new Map<string, SlotSpec>();
  for (const s of slots) byKey.set(`${s.col},${s.row}`, s);

  // Group assignment: each Prism launches with two adjacent Shards as escorts
  // (forced to opposite bands), then the rest fly in in staggered row-major
  // batches. A new group launches every ENTER_GROUP_GAP seconds.
  const assigned = new Set<string>();
  const groups: SlotSpec[][] = [];
  const kk = (c: number, r: number) => `${c},${r}`;

  for (const s of slots) {
    if (s.kind !== "prism") continue;
    const escorts: SlotSpec[] = [];
    for (const dc of [-1, 1]) {
      const n = byKey.get(kk(s.col + dc, s.row)) ?? byKey.get(kk(s.col + dc, s.row + 1));
      if (n && n.kind === "shard" && !assigned.has(kk(n.col, n.row))) escorts.push(n);
    }
    // Force the two escorts to opposite bands (one cyan, one magenta).
    escorts.forEach((e, i) => {
      e.band = i === 0 ? CYAN : MAGENTA;
    });
    const group = [s, ...escorts];
    for (const g of group) assigned.add(kk(g.col, g.row));
    groups.push(group);
  }

  // Remaining drones in row-major batches of 4.
  const rest = slots.filter((s) => !assigned.has(kk(s.col, s.row)));
  rest.sort((a, b) => a.row - b.row || a.col - b.col);
  for (let i = 0; i < rest.length; i += 4) groups.push(rest.slice(i, i + 4));

  const entrants: Entrant[] = [];
  groups.forEach((group, gi) => {
    for (const s of group) {
      const fromLeft = s.col <= 4;
      entrants.push({ drone: makeDrone(s, fromLeft, rng), releaseAt: gi * ENTER_GROUP_GAP });
    }
  });
  return entrants;
}

// ---- Challenge stage flyover groups (specs/gameplay.md) -----------------------

export interface ChallengeDrone {
  drone: Drone;
  releaseAt: number;
}

// A group sweeps horizontally across the field along a gentle arc and exits.
// Groups alternate bands (cyan, magenta, ...). Drones never fire and cost no
// life on contact (enforced in the Game).
export function buildChallenge(): ChallengeDrone[] {
  const out: ChallengeDrone[] = [];
  const groups = 5;
  const per = 8;
  for (let g = 0; g < groups; g++) {
    const band: Band = g % 2 === 0 ? CYAN : MAGENTA;
    const fromLeft = g % 2 === 0;
    const y = 150 + (g % 4) * 70;
    for (let i = 0; i < per; i++) {
      const startX = fromLeft ? -60 - i * 60 : 1340 + i * 60;
      const endX = fromLeft ? 1360 : -80;
      const dir = fromLeft ? 1 : -1;
      const knots: Vec2[] = [
        { x: startX, y },
        { x: startX + dir * 350, y: y - 50 },
        { x: startX + dir * 700, y: y + 60 },
        { x: startX + dir * 1050, y: y - 40 },
        { x: endX, y },
      ];
      const drone: Drone = {
        id: 0,
        kind: "shard",
        band,
        x: startX,
        y,
        prevX: startX,
        prevY: y,
        col: 0,
        row: 0,
        slotX: startX,
        slotY: y,
        phase: "diving",
        angle: 0,
        dead: false,
        path: smoothPath(knots),
        pathDist: 0,
        fireAt: [],
        fluxBase: band,
        fluxClock: 0,
        shimmer: false,
        shellBand: band,
        coreBand: opposite(band),
        shellAlive: false,
        invertedThisDive: false,
      };
      out.push({ drone, releaseAt: g * 2.2 + i * 0.14 });
    }
  }
  return out;
}
