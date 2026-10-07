// Spectra — what a wave is made of, and where each drone starts
// (`specs/swarm.md`, `specs/stages.md`).
//
// A wave is built in the moment the stage-intro hold gives way, and from that
// moment the roster holds every drone of it, each in phase `entering` at its own
// starting point above the play field. Nothing arrives later: what a released
// group does is start travelling, and `specs/swarm.md`'s schedule is a per-drone
// release delay of `ENTER_GROUP_GAP` times the group's index.
//
// A standard wave fills a symmetric block that grows with the stage and leans
// further on Fluxes and Prisms as it does. Every filled slot has its mirror
// filled, the Shards alternate bands along each row so both bands stand at all
// times, and each Prism arrives with two Shards of opposite bands in its own entry
// group.
//
// A challenge stage is not a wave: it is five groups of eight one-band Shards that
// sweep across the field and leave, so their slots hold the points they entered at
// and none of them ever settles.

import {
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  DIVE_FIRST_DELAY,
  FIELD_TOP,
  FORM_COLS,
  FORM_ROWS,
  STAGE_W,
  fluxWindow,
  isChallengeStage,
  slotX,
  slotY,
} from "./constants";
import { randomInt, randomRange, shuffled } from "./random";
import type { MutDrone, Sim } from "./sim";
import type { Band, DroneKind } from "./game";

/** How wide each row of the block is, from the top down. */
const ROW_WIDTHS = [5, 7, 9, 7, 5] as const;

/** How far to the side of its slot a drone starts, before the entrance curves in. */
const ENTER_OFFSET_X = 220;

/** How far above the play field the first, second and third of a group start. */
const ENTER_START_Y = FIELD_TOP - 30;
const ENTER_START_STEP = 28;

/** How far to either side of a Prism its two escorts start. */
const ESCORT_OFFSET_X = 46;

/** A challenge group's lead-in off the near edge, and the gap along its line. */
const CHALLENGE_LEAD = 50;
const CHALLENGE_GAP = 32;

/** The height a challenge group flies in at, above the play field. */
export const CHALLENGE_START_Y = 24;

/** One slot of the block, and what stands in it. */
interface Slot {
  readonly col: number;
  readonly row: number;
  readonly kind: DroneKind;
  readonly band: Band;
  readonly group: number;
  /** The Prism this Shard escorts in, counted from `0`, or `null`. */
  readonly escortOf: number | null;
}

/** How many rows of the block a standard stage fills. */
export function waveRows(stage: number): number {
  return Math.min(FORM_ROWS, 3 + Math.floor((stage - 1) / 3));
}

/** How many Prisms anchor a standard stage's block. */
export function wavePrisms(stage: number): number {
  return Math.min(3, 1 + Math.floor((stage - 1) / 4));
}

/** How many mirrored pairs of Fluxes a standard stage's block holds. */
export function waveFluxPairs(stage: number): number {
  return Math.min(4, 1 + Math.floor((stage - 1) / 3));
}

/** The columns row `row` fills, which is a run centred on the grid's middle. */
function rowColumns(row: number): number[] {
  const width = ROW_WIDTHS[row] ?? ROW_WIDTHS[0];
  const first = (FORM_COLS - width) / 2;
  return Array.from({ length: width }, (_, i) => first + i);
}

/** The columns of row 0 the stage's Prisms take, centred and symmetric. */
function prismColumns(count: number): number[] {
  if (count <= 1) return [4];
  if (count === 2) return [3, 5];
  return [3, 4, 5];
}

/** The centre of the slot in column `col`, row `row`, before the sway. */
export function slotCentre(col: number, row: number): { x: number; y: number } {
  return { x: slotX(col), y: slotY(row) };
}

/**
 * The layout of a standard stage's block.
 *
 * The filled slots are whole rows, so the block is mirror-symmetric by
 * construction. What is drawn is which mirrored pairs hold the Fluxes and which
 * way each row's Shard bands alternate.
 */
export function waveLayout(stage: number): Slot[] {
  const rows = waveRows(stage);
  const prisms = prismColumns(wavePrisms(stage));

  // Which mirrored pairs become Fluxes: the flanks of every row below the top,
  // shuffled so the choice is a draw.
  const candidates: { col: number; row: number }[] = [];
  for (let row = 1; row < rows; row++) {
    for (const col of rowColumns(row)) {
      if (col < (FORM_COLS - 1) / 2) candidates.push({ col, row });
    }
  }
  const order = shuffled(candidates);
  const fluxPairs = order.slice(0, waveFluxPairs(stage));
  const isFlux = (col: number, row: number): boolean =>
    fluxPairs.some(
      (pair) =>
        pair.row === row &&
        (pair.col === col || FORM_COLS - 1 - pair.col === col),
    );

  // Which way each row's Shard bands alternate.
  const parity: number[] = [];
  for (let row = 0; row < rows; row++) {
    parity.push(randomInt(0, 1));
  }

  const slots: Slot[] = [];
  for (let row = 0; row < rows; row++) {
    for (const col of rowColumns(row)) {
      const prism = row === 0 && prisms.includes(col);
      const kind: DroneKind = prism
        ? "prism"
        : isFlux(col, row)
          ? "flux"
          : "shard";
      const band: Band =
        (col + (parity[row] ?? 0)) % 2 === 0 ? "cyan" : "magenta";
      // A Prism and its escorts fly in together, ahead of the rows.
      slots.push({
        col,
        row,
        kind,
        band,
        group: prism ? 0 : row + 1,
        escortOf: null,
      });
    }
  }

  // Each Prism's escort: the two nearest free Shard slots, one of each band,
  // moved into the Prism's own entry group.
  const taken = new Set<number>();
  slots
    .map((slot, index) => ({ slot, index }))
    .filter((entry) => entry.slot.kind === "prism")
    .forEach((prism, prismIndex) => {
      const anchor = slotCentre(prism.slot.col, prism.slot.row);
      for (const band of ["cyan", "magenta"] as const) {
        let pick = -1;
        let best = Infinity;
        slots.forEach((slot, index) => {
          if (slot.kind !== "shard" || taken.has(index)) return;
          const centre = slotCentre(slot.col, slot.row);
          const distance = Math.hypot(centre.x - anchor.x, centre.y - anchor.y);
          if (distance < best) {
            best = distance;
            pick = index;
          }
        });
        if (pick < 0) continue;
        taken.add(pick);
        const slot = slots[pick] as Slot;
        slots[pick] = {
          ...slot,
          band,
          group: prism.slot.group,
          escortOf: prismIndex,
        };
      }
    });

  return slots;
}

/** Where a drone of a standard wave starts, given its slot and its place in line. */
function standardStart(slot: Slot, place: number): { x: number; y: number } {
  const side = slot.group % 2 === 0 ? -1 : 1;
  const centre = slotCentre(slot.col, slot.row);
  const x = Math.max(
    60,
    Math.min(STAGE_W - 60, centre.x + side * ENTER_OFFSET_X),
  );
  return { x, y: ENTER_START_Y - (place % 3) * ENTER_START_STEP };
}

/** A drone at rest, ready to have its own fields written over it. */
export function freshDrone(
  sim: Sim,
  kind: DroneKind,
  x: number,
  y: number,
  band: Band,
): MutDrone {
  const id = sim.nextId;
  sim.nextId = id + 1;
  return {
    id,
    kind,
    x,
    y,
    band,
    phase: "entering",
    phaseClock: 0,
    slotX: x,
    slotY: y,
    entryGroup: 0,
    bandClock: 0,
    shellAlive: true,
    shotsFired: 0,
    travel: true,
    oscillation: true,
    fire: true,
    charge: 0,
  };
}

/** Point the drone at the slot it is flying to, and at its entry group. */
function withSlot(drone: MutDrone, slot: Slot): MutDrone {
  const centre = slotCentre(slot.col, slot.row);
  drone.slotX = centre.x;
  drone.slotY = centre.y;
  drone.entryGroup = slot.group;
  return drone;
}

/** Build the stage's standard wave onto the field. */
function buildStandardWave(sim: Sim): void {
  const slots = waveLayout(sim.stage);

  const placed = new Map<number, number>();
  const prismStarts: { x: number; y: number }[] = [];
  const escorts = new Map<number, number>();
  const drones: MutDrone[] = [];

  // The Prisms first, so their escorts can start beside them.
  for (const slot of slots) {
    if (slot.kind !== "prism") continue;
    const place = placed.get(slot.group) ?? 0;
    placed.set(slot.group, place + 1);
    const start = standardStart(slot, place);
    prismStarts.push(start);
    drones.push(
      withSlot(freshDrone(sim, "prism", start.x, start.y, slot.band), slot),
    );
  }

  for (const slot of slots) {
    if (slot.kind === "prism") continue;
    let start: { x: number; y: number };
    if (slot.escortOf !== null) {
      // An escort arrives alongside the Prism it came in with.
      const anchor = prismStarts[slot.escortOf] ?? {
        x: STAGE_W / 2,
        y: ENTER_START_Y,
      };
      const flown = escorts.get(slot.escortOf) ?? 0;
      escorts.set(slot.escortOf, flown + 1);
      start = {
        x: anchor.x + (flown % 2 === 0 ? -ESCORT_OFFSET_X : ESCORT_OFFSET_X),
        y: anchor.y,
      };
    } else {
      const place = placed.get(slot.group) ?? 0;
      placed.set(slot.group, place + 1);
      start = standardStart(slot, place);
    }
    const drone = withSlot(
      freshDrone(sim, slot.kind, start.x, start.y, slot.band),
      slot,
    );
    if (drone.kind === "flux") {
      // A Flux enters part-way into a band window, so a wave's Fluxes shimmer
      // out of step with one another.
      drone.bandClock = randomRange(0, fluxWindow(sim.stage));
    }
    drones.push(drone);
  }

  sim.drones = drones;
}

/** Build the stage's challenge flyover onto the field. */
function buildChallengeWave(sim: Sim): void {
  const drones: MutDrone[] = [];
  for (let group = 0; group < CHALLENGE_GROUPS; group++) {
    const band: Band = group % 2 === 0 ? "cyan" : "magenta";
    const side = group % 2 === 0 ? 1 : -1;
    for (let place = 0; place < CHALLENGE_PER_GROUP; place++) {
      const lead = CHALLENGE_LEAD + place * CHALLENGE_GAP;
      const x = side > 0 ? -lead : STAGE_W + lead;
      const drone = freshDrone(sim, "shard", x, CHALLENGE_START_Y, band);
      drone.entryGroup = group;
      drones.push(drone);
    }
  }
  sim.drones = drones;
}

/**
 * Build the stage's wave and start its clocks.
 *
 * Called in the one moment `specs/stages.md` names: as the stage-intro hold gives
 * way to the live wave.
 */
export function buildWave(sim: Sim): void {
  sim.bullets = [];
  sim.bursts = [];
  sim.discharge = { active: false, radius: 0 };
  sim.entryClock = 0;
  sim.swayClock = 0;
  sim.diveClock = 0;
  sim.diveTarget = DIVE_FIRST_DELAY;
  sim.challengeHits = 0;

  if (isChallengeStage(sim.stage)) buildChallengeWave(sim);
  else buildStandardWave(sim);
}

/**
 * A formation slot nothing stands in, nearest `(x, y)`, or that point itself
 * where the block is full.
 */
export function freeFormationSlot(
  sim: Sim,
  x: number,
  y: number,
): { x: number; y: number } {
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (let row = 0; row < FORM_ROWS; row++) {
    for (let col = 0; col < FORM_COLS; col++) {
      const centre = slotCentre(col, row);
      const held = sim.drones.some(
        (drone) =>
          Math.abs(drone.slotX - centre.x) < 1 &&
          Math.abs(drone.slotY - centre.y) < 1,
      );
      if (held) continue;
      const distance = Math.hypot(centre.x - x, centre.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = centre;
      }
    }
  }
  return best ?? { x, y };
}
