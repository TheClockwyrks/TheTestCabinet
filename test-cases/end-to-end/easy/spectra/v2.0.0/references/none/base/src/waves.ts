// Spectra — what a wave is made of, and how its drones fly in.
//
// Two builders live here, one per kind of stage (specs/swarm.md,
// specs/stages.md):
//
//   * `buildStandardWave` — the formation: a mirror-symmetric block of filled
//     slots holding Shards of both bands as its bulk, at least two Fluxes and at
//     least one Prism, growing toward the grid's capacity with the stage and
//     leaning further on Fluxes and Prisms as it does. Every drone is on the
//     roster from the moment the wave is built, in phase `entering`, at its own
//     starting point above `FIELD_TOP`, waiting for its entry group's release.
//   * `buildChallengeWave` — `CHALLENGE_GROUPS` groups of `CHALLENGE_PER_GROUP`
//     single-band drones, consecutive groups on opposite bands, each group
//     sweeping across the play field and off the far side.
//
// EVERY GROUP COUNT IS BETWEEN TWO AND EIGHT, which is why the batch size the
// non-escort drones are grouped in is derived from what is left rather than
// fixed: a full grid would otherwise want more groups than a wave may have.
//
// Every random choice — the layout's Flux phases among them — is drawn from the
// state's own generator, so the same seed builds the same wave.

import {
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  ENTER_SPEED,
  FIELD_TOP,
  FORM_COLS,
  PRISM_ESCORTS,
  fluxWindow,
  opposite,
  slotX,
  slotY,
  type Band,
} from "./constants";
import { smoothPath, type Vec2 } from "./paths";
import { Rng } from "./rng";
import type { Drone, DroneKind, SpectraState } from "./types";

/** The most entry groups a wave may release its drones in. */
export const MAX_ENTRY_GROUPS = 8;

/** How far above `FIELD_TOP` a drone waits for its group's release. */
export const ENTRY_START_Y = FIELD_TOP - 40;

/** One slot of the built formation. */
export interface SlotSpec {
  col: number;
  row: number;
  kind: DroneKind;
  band: Band;
}

/** The columns a stage's block spans, centred and therefore symmetric. */
export function waveColumns(stage: number): number[] {
  const used = Math.min(FORM_COLS, 5 + 2 * Math.floor((stage - 1) / 2));
  const centre = (FORM_COLS - 1) / 2;
  const half = (used - 1) / 2;
  const columns: number[] = [];
  for (let c = centre - half; c <= centre + half; c += 1) columns.push(c);
  return columns;
}

/** The rows a stage's block spans, from the top row down. */
export function waveRows(stage: number): number {
  return Math.min(5, 3 + Math.floor((stage - 1) / 2));
}

/** The Prisms a stage's block anchors on. */
export function prismCount(stage: number): number {
  return Math.min(3, 1 + Math.floor((stage - 1) / 4));
}

/** The Fluxes a stage's block carries. */
export function fluxCount(stage: number): number {
  return Math.min(6, 2 + 2 * Math.floor((stage - 1) / 3));
}

/**
 * The filled formation for `stage`, as one spec per slot.
 *
 * The block is a full rectangle of centred columns, so the filled layout is
 * mirror-symmetric about `FORM_CENTER_X` by construction: every column it fills
 * has its mirror filled in the same rows. The Prisms sit across the top row and
 * the Fluxes in symmetric pairs below them; the rest are Shards on a
 * checkerboard of the two bands, so the block always holds both.
 */
export function buildLayout(stage: number): SlotSpec[] {
  const columns = waveColumns(stage);
  const rows = waveRows(stage);
  const centre = (FORM_COLS - 1) / 2;
  const filled = new Map<string, SlotSpec>();
  const key = (col: number, row: number): string => `${col},${row}`;

  // Shards on a checkerboard, first, so every slot has a kind and a band.
  for (let row = 0; row < rows; row += 1) {
    for (const col of columns) {
      filled.set(key(col, row), {
        col,
        row,
        kind: "shard",
        band: (col + row) % 2 === 0 ? "cyan" : "magenta",
      });
    }
  }

  // The Prisms: the centre of the top row, then a symmetric pair either side.
  const prismColumns = [centre, centre - 2, centre + 2].filter((col) =>
    columns.includes(col),
  );
  const prisms = Math.min(prismCount(stage), prismColumns.length);
  for (let i = 0; i < prisms; i += 1) {
    const col = prismColumns[i];
    if (col === undefined) continue;
    const slot = filled.get(key(col, 0));
    if (slot === undefined) continue;
    slot.kind = "prism";
    // The shells alternate, so the top row reads both bands at a glance.
    slot.band = i % 2 === 0 ? "cyan" : "magenta";
  }

  // The Fluxes: symmetric pairs, working outward from the centre of row 1, and
  // spilling onto row 2 once row 1 is used up.
  const fluxes = fluxCount(stage);
  const offsets = [1, 2, 3, 4];
  const candidates: Array<{ col: number; row: number }> = [];
  for (const row of [1, 2]) {
    if (row >= rows) continue;
    for (const offset of offsets) {
      for (const col of [centre - offset, centre + offset]) {
        if (columns.includes(col)) candidates.push({ col, row });
      }
    }
  }
  let placed = 0;
  for (const candidate of candidates) {
    if (placed >= fluxes) break;
    const slot = filled.get(key(candidate.col, candidate.row));
    if (slot === undefined || slot.kind !== "shard") continue;
    slot.kind = "flux";
    slot.band = candidate.col < centre ? "cyan" : "magenta";
    placed += 1;
  }

  return [...filled.values()];
}

/**
 * The entry groups of a built layout.
 *
 * Each Prism leads a group of its own with `PRISM_ESCORTS` Shards alongside it,
 * one of each band, and the rest fly in in row-major batches sized so the whole
 * wave never wants more than `MAX_ENTRY_GROUPS` groups.
 */
export function groupLayout(slots: readonly SlotSpec[]): SlotSpec[][] {
  const taken = new Set<SlotSpec>();
  const groups: SlotSpec[][] = [];
  const shards = slots.filter((slot) => slot.kind === "shard");

  for (const prism of slots) {
    if (prism.kind !== "prism") continue;
    const escorts: SlotSpec[] = [];
    // The nearest unclaimed Shards, so the escort really does fly in alongside.
    const byDistance = [...shards]
      .filter((shard) => !taken.has(shard))
      .sort(
        (a, b) =>
          Math.hypot(a.col - prism.col, a.row - prism.row) -
          Math.hypot(b.col - prism.col, b.row - prism.row),
      );
    for (const shard of byDistance) {
      if (escorts.length >= PRISM_ESCORTS) break;
      escorts.push(shard);
      taken.add(shard);
    }
    // One of each band, whatever the checkerboard gave them.
    escorts.forEach((escort, index) => {
      escort.band = index === 0 ? "cyan" : "magenta";
    });
    taken.add(prism);
    groups.push([prism, ...escorts]);
  }

  const rest = slots.filter((slot) => !taken.has(slot));
  rest.sort((a, b) => a.row - b.row || a.col - b.col);
  const remaining = Math.max(1, MAX_ENTRY_GROUPS - groups.length);
  const batch = Math.max(3, Math.ceil(rest.length / remaining));
  for (let i = 0; i < rest.length; i += batch) {
    groups.push(rest.slice(i, i + batch));
  }
  return groups;
}

/**
 * The entrance a drone bound for `(targetX, targetY)` flies.
 *
 * It starts above the play field, crosses `FIELD_TOP` within the first few dozen
 * units of travel — well inside the second the specification allows — sweeps in
 * from one side, and ends on the slot. At `ENTER_SPEED` the whole curve takes
 * around three seconds, inside the six the specification allows.
 */
export function entrancePath(
  targetX: number,
  targetY: number,
  fromLeft: boolean,
): ReturnType<typeof smoothPath> {
  const side = fromLeft ? -1 : 1;
  const knots: Vec2[] = [
    { x: targetX + side * 220, y: ENTRY_START_Y },
    { x: targetX + side * 260, y: 150 },
    { x: targetX - side * 60, y: targetY + 70 },
    { x: targetX, y: targetY },
  ];
  return smoothPath(knots);
}

/** The sweep one challenge drone flies across the field and off the far side. */
export function challengeSweep(
  row: number,
  index: number,
  fromLeft: boolean,
): ReturnType<typeof smoothPath> {
  const direction = fromLeft ? 1 : -1;
  const startX = fromLeft ? -60 - index * 34 : 1340 + index * 34;
  const endX = fromLeft ? 1400 : -120;
  const y = row + (index % 2 === 0 ? 0 : 24);
  const knots: Vec2[] = [
    { x: startX, y },
    { x: startX + direction * 400, y: y - 50 },
    { x: startX + direction * 800, y: y + 60 },
    { x: startX + direction * 1200, y: y - 40 },
    { x: endX, y },
  ];
  return smoothPath(knots);
}

/** A blank drone with every field at its resting value. */
function makeDrone(
  state: SpectraState,
  kind: DroneKind,
  band: Band,
  x: number,
  y: number,
  targetX: number,
  targetY: number,
  entryGroup: number,
): Drone {
  return {
    id: state.nextId++,
    kind,
    x,
    y,
    band,
    phase: "entering",
    phaseSeconds: 0,
    slotX: targetX,
    slotY: targetY,
    entryGroup,
    released: false,
    bandClock: 0,
    shellAlive: true,
    shots: 0,
    firePending: false,
    travel: true,
    oscillation: true,
    fire: true,
    path: null,
    pathDist: 0,
    dead: false,
    popAt: 0,
  };
}

/** The formation a standard stage sends in, every drone already on the roster. */
export function buildStandardWave(state: SpectraState): Drone[] {
  const groups = groupLayout(buildLayout(state.stage));
  const rng = new Rng(state.rngState);
  const window = fluxWindow(state.stage);
  const drones: Drone[] = [];
  const centre = (FORM_COLS - 1) / 2;

  groups.forEach((group, index) => {
    for (const slot of group) {
      const targetX = slotX(slot.col);
      const targetY = slotY(slot.row);
      const fromLeft = slot.col <= centre;
      const path = entrancePath(targetX, targetY, fromLeft);
      const start = path.at(0);
      const drone = makeDrone(
        state,
        slot.kind,
        slot.band,
        start.x,
        start.y,
        targetX,
        targetY,
        index,
      );
      drone.path = path;
      // A Flux's starting phase is drawn, so a wave's Fluxes are not in lockstep.
      if (slot.kind === "flux") drone.bandClock = rng.unit() * window;
      drones.push(drone);
    }
  });

  state.rngState = rng.state;
  return drones;
}

/** The rows the challenge groups sweep along. */
const CHALLENGE_ROWS = [150, 230, 310, 390];

/** The flyover a challenge stage sends across, group by alternating group. */
export function buildChallengeWave(state: SpectraState): Drone[] {
  const drones: Drone[] = [];
  for (let group = 0; group < CHALLENGE_GROUPS; group += 1) {
    // Every drone in a group carries the same band, and consecutive groups carry
    // opposite bands, so the bands alternate from the first group to the last.
    const band: Band = group % 2 === 0 ? "cyan" : opposite("cyan");
    const fromLeft = group % 2 === 0;
    const row = CHALLENGE_ROWS[group % CHALLENGE_ROWS.length] ?? 150;
    for (let index = 0; index < CHALLENGE_PER_GROUP; index += 1) {
      const path = challengeSweep(row, index, fromLeft);
      const start = path.at(0);
      const drone = makeDrone(
        state,
        "shard",
        band,
        start.x,
        start.y,
        start.x,
        start.y,
        group,
      );
      drone.path = path;
      drones.push(drone);
    }
  }
  return drones;
}

/** How long, at stage-1 speed, the longest path a wave builds takes to fly. */
export function longestEntrance(stage: number): number {
  let longest = 0;
  for (const slot of buildLayout(stage)) {
    const path = entrancePath(
      slotX(slot.col),
      slotY(slot.row),
      slot.col <= (FORM_COLS - 1) / 2,
    );
    longest = Math.max(longest, path.length / ENTER_SPEED);
  }
  return longest;
}
