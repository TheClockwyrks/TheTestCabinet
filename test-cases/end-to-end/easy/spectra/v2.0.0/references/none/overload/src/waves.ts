// Spectra — what a wave is made of, and the flyover a challenge stage is instead.
//
// `specs/swarm.md` fixes what a standard wave must hold and leaves the layout to
// the build, subject to three rules the layout below satisfies by construction:
//
//   * MIRROR SYMMETRY. The filled slots are always a symmetric set of whole
//     columns, so for every filled slot at `x` the slot at `2 * FORM_CENTER_X - x`
//     is filled too.
//   * BOTH BANDS AT ALL TIMES. The Shards checkerboard their band over the filled
//     block, so both bands are present however the Fluxes happen to be oscillating.
//   * A DELIBERATE BLOCK. Whole columns and whole rows, Prisms across the top and
//     Fluxes on the row under them, growing with the stage toward the grid's
//     capacity and leaning further on Fluxes and Prisms as it goes.
//
// THE GROUPS. A wave releases its drones in between two and eight groups, and every
// Prism's group carries its `PRISM_ESCORTS` Shards, one of each band, so the three
// fly in alongside one another. Every drone of one group enters from the SAME SIDE,
// which is what keeps an escort beside the Prism it escorts rather than sweeping in
// from the far edge of the stage.

import {
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  CYAN,
  FORM_COLS,
  FORM_ROWS,
  MAGENTA,
  PRISM_ESCORTS,
  fluxWindow,
  slotX,
  slotY,
} from "./constants";
import { addDrone } from "./entities";
import { nextRange } from "./rng";
import { challengePath, entrancePath, entranceStart } from "./swarm";
import type { Band, DroneKind, SpectraState } from "./types";

/** The most groups a wave may release its drones in. */
export const MAX_ENTRY_GROUPS = 8;

/** The fewest drones a non-escort entry group holds. */
const MIN_BATCH = 3;

/** The `y` bands a challenge group sweeps along. */
const CHALLENGE_ROWS = [150, 220, 290, 360] as const;

/** How far apart two columns of one challenge group start along their path. */
const CHALLENGE_OFFSET = 40;

/** How far the second rank of a challenge group flies below the first. */
const CHALLENGE_RANK_DY = 34;

/** One slot of the formation a wave is built into. */
interface SlotSpec {
  col: number;
  row: number;
  kind: DroneKind;
  band: Band;
}

const key = (col: number, row: number): string => `${col},${row}`;

/** The symmetric set of columns a wave at `stage` fills. */
export function filledColumns(stage: number): number[] {
  const used = Math.min(FORM_COLS, 5 + 2 * Math.floor((stage - 1) / 2));
  const half = (used - 1) / 2;
  const centre = (FORM_COLS - 1) / 2;
  const columns: number[] = [];
  for (let col = centre - half; col <= centre + half; col += 1)
    columns.push(col);
  return columns;
}

/** How many rows a wave at `stage` fills. */
export function filledRows(stage: number): number {
  return Math.min(FORM_ROWS, 3 + Math.floor((stage - 1) / 2));
}

/** How many Prisms a wave at `stage` holds. */
export function prismCount(stage: number): number {
  return Math.min(3, 1 + Math.floor((stage - 1) / 4));
}

/** How many Fluxes a wave at `stage` holds. */
export function fluxCount(stage: number): number {
  return Math.min(6, 2 + 2 * Math.floor((stage - 1) / 3));
}

/** Every filled slot of a wave at `stage`, with the kind and band each carries. */
export function waveSlots(stage: number): SlotSpec[] {
  const columns = filledColumns(stage);
  const rows = filledRows(stage);
  const centre = (FORM_COLS - 1) / 2;
  const filled = new Map<string, SlotSpec>();

  // Prisms across the top row, centred and symmetric, their shell bands
  // alternating so the top row reads both bands at a glance.
  const prismCols = [centre, centre - 2, centre + 2].slice(
    0,
    prismCount(stage),
  );
  prismCols.forEach((col, index) => {
    if (!columns.includes(col)) return;
    filled.set(key(col, 0), {
      col,
      row: 0,
      kind: "prism",
      band: index % 2 === 0 ? CYAN : MAGENTA,
    });
  });

  // Fluxes in symmetric pairs on the row under them, working outward.
  const fluxOrder = [
    centre - 2,
    centre + 2,
    centre - 3,
    centre + 3,
    centre - 1,
    centre + 1,
  ];
  let fluxes = 0;
  for (const col of fluxOrder) {
    if (fluxes >= fluxCount(stage)) break;
    if (!columns.includes(col) || filled.has(key(col, 1)) || rows < 2) continue;
    filled.set(key(col, 1), {
      col,
      row: 1,
      kind: "flux",
      band: col < centre ? CYAN : MAGENTA,
    });
    fluxes += 1;
  }

  // Shards fill the rest, checkerboarding their band so both are always present.
  for (let row = 0; row < rows; row += 1) {
    for (const col of columns) {
      if (filled.has(key(col, row))) continue;
      filled.set(key(col, row), {
        col,
        row,
        kind: "shard",
        band: (col + row) % 2 === 0 ? CYAN : MAGENTA,
      });
    }
  }

  return [...filled.values()];
}

/** The slots of a wave, gathered into the groups it releases them in. */
export function entryGroups(stage: number): SlotSpec[][] {
  const slots = waveSlots(stage);
  const bySlot = new Map<string, SlotSpec>();
  for (const slot of slots) bySlot.set(key(slot.col, slot.row), slot);

  const taken = new Set<string>();
  const groups: SlotSpec[][] = [];

  // One group per Prism, carrying its escorts: the nearest free Shards, forced to
  // opposite bands so the trio really does bring one of each.
  for (const slot of slots) {
    if (slot.kind !== "prism") continue;
    const escorts: SlotSpec[] = [];
    for (const dcol of [-1, 1, -2, 2]) {
      if (escorts.length >= PRISM_ESCORTS) break;
      const beside =
        bySlot.get(key(slot.col + dcol, slot.row)) ??
        bySlot.get(key(slot.col + dcol, slot.row + 1));
      if (beside === undefined || beside.kind !== "shard") continue;
      if (taken.has(key(beside.col, beside.row))) continue;
      taken.add(key(beside.col, beside.row));
      escorts.push(beside);
    }
    escorts.forEach((escort, index) => {
      escort.band = index === 0 ? CYAN : MAGENTA;
    });
    taken.add(key(slot.col, slot.row));
    groups.push([slot, ...escorts]);
  }

  // Everything else, in row-major batches sized so the whole wave still fits in
  // `MAX_ENTRY_GROUPS` groups however large a later stage's formation grows.
  const rest = slots
    .filter((slot) => !taken.has(key(slot.col, slot.row)))
    .sort((a, b) => a.row - b.row || a.col - b.col);
  const batches = Math.max(1, MAX_ENTRY_GROUPS - groups.length);
  const size = Math.max(MIN_BATCH, Math.ceil(rest.length / batches));
  for (let at = 0; at < rest.length; at += size) {
    groups.push(rest.slice(at, at + size));
  }
  return groups;
}

/**
 * Build the stage's standard wave onto the field.
 *
 * Every drone of the wave is on the roster from this moment, in phase `entering`,
 * at its own starting point above `FIELD_TOP`, so no drone stands inside the play
 * field when the wave opens.
 */
export function buildWave(state: SpectraState, stage: number): void {
  entryGroups(stage).forEach((group, index) => {
    // Every drone of one group enters from the same side, alternating group by
    // group, which is what keeps a Prism's escorts alongside it.
    const fromLeft = index % 2 === 0;
    for (const slot of group) {
      const centreX = slotX(slot.col);
      const centreY = slotY(slot.row);
      const start = entranceStart(centreX, fromLeft);
      const drone = addDrone(state, {
        kind: slot.kind,
        band: slot.band,
        x: start.x,
        y: start.y,
        slotX: centreX,
        slotY: centreY,
        group: index,
        released: false,
        phase: "entering",
        ofWave: true,
      });
      drone.path = entrancePath(centreX, centreY, fromLeft);
      // A Flux's starting phase is drawn from the game's own generator, so a wave
      // does not arrive with every Flux shimmering in lockstep
      // (specs/simulation.md).
      if (slot.kind === "flux") {
        drone.bandClock = nextRange(state, 0, fluxWindow(stage));
      }
    }
  });
}

/**
 * Build a challenge stage's flyover onto the field.
 *
 * `CHALLENGE_GROUPS` groups of `CHALLENGE_PER_GROUP`, every drone of a group
 * carrying the same band and consecutive groups carrying opposite bands. Each
 * sweeps the field along its own arc and is retired when it leaves; none settles
 * into a formation slot and none fires.
 */
export function buildChallenge(state: SpectraState): void {
  for (let group = 0; group < CHALLENGE_GROUPS; group += 1) {
    const band: Band = group % 2 === 0 ? CYAN : MAGENTA;
    const fromLeft = group % 2 === 0;
    const y = CHALLENGE_ROWS[group % CHALLENGE_ROWS.length] as number;
    for (let index = 0; index < CHALLENGE_PER_GROUP; index += 1) {
      // Two ranks abreast rather than one long file: the whole group has to cross
      // into the field inside one `ENTER_GROUP_GAP`, or its arrival interleaves
      // with the next group's and the alternating bands stop reading as groups.
      const column = Math.floor(index / 2);
      const rank = index % 2;
      const path = challengePath(
        y + rank * CHALLENGE_RANK_DY,
        fromLeft,
        column * CHALLENGE_OFFSET,
      );
      const start = path.at(0);
      const drone = addDrone(state, {
        kind: "shard",
        band,
        x: start.x,
        y: start.y,
        slotX: start.x,
        slotY: start.y,
        group,
        released: false,
        phase: "entering",
        challenge: true,
        ofWave: true,
      });
      drone.path = path;
    }
  }
}
