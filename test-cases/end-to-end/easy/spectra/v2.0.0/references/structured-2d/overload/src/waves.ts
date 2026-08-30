// Spectra — what a wave is made of, and where its drones come in from
// (specs/swarm.md, specs/stages.md).
//
// A wave is built in the moment the stage-intro hold gives way, and the drone
// roster holds every drone of it from that moment, each in phase `entering` at
// its own starting point above the play field, so no drone stands inside the
// field when the wave opens. The wave then releases them in groups, one group per
// formation row, `ENTER_GROUP_GAP` apart.
//
// WHICH SLOTS A WAVE FILLS is the build's, subject to three rules
// (`specs/swarm.md`): the filled layout is mirror-symmetric about
// `FORM_CENTER_X`, the formation holds at least one drone of each effective band,
// and it reads as a deliberate block. A wave is therefore laid out as whole
// centred rows, which is symmetric by construction, and the Shards alternate
// bands across it.
//
// A CHALLENGE STAGE is not a wave at all: it is `CHALLENGE_GROUPS` groups of
// `CHALLENGE_PER_GROUP` single-band drones released on the same schedule, sweeping
// across the field and leaving it.

import {
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  DIVE_FIRST_DELAY,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FORM_CENTER_X,
  FORM_COLS,
  FORM_ROWS,
  isChallengeStage,
  slotX,
  slotY,
} from "./constants";
import { fluxWindowAt } from "./bands";
import { addDroneTo } from "./drones";
import { random, randomInt, randomRange } from "./rng";
import { CHALLENGE_MARGIN, CHALLENGE_ROW0, CHALLENGE_ROW_GAP } from "./swarm";
import type { Band, DroneKind, SpectraState } from "./game";

/** How far above `FIELD_TOP` the leader of an entry group starts. */
const ENTRY_LEAD = 90;
/** How far behind the leader each later drone of the same group starts. */
const ENTRY_STACK = 22;
/** How far outside the formation's centre a group comes down. */
const ENTRY_SIDE_X = 320;

/**
 * The row patterns a wave's block is cut from. Every entry is odd and centred, so
 * a row is mirror-symmetric about `FORM_CENTER_X` by construction, and which
 * pattern a wave takes is drawn from the game's own generator — so a run replayed
 * from one seed builds the same block and a run from another builds a different
 * one.
 */
const ROW_PATTERNS: readonly (readonly number[])[] = [
  [5, 7, 9, 9, 7],
  [7, 9, 9, 7, 5],
  [9, 7, 5, 7, 9],
  [5, 9, 7, 9, 5],
];

/** How many rows the formation fills at `stage`. */
export function formationRows(stage: number): number {
  return Math.min(FORM_ROWS, 3 + Math.floor((stage - 1) / 3));
}

/** How many Prisms anchor the wave at `stage`. */
export function prismCount(stage: number): number {
  return 1 + Math.floor((stage - 1) / 4);
}

/** How many Fluxes the wave at `stage` leans on. */
export function fluxCount(stage: number): number {
  return 2 + Math.floor((stage - 1) / 3);
}

/** One slot of the layout: its column, its row, and its place within the row. */
export interface Slot {
  col: number;
  row: number;
  index: number;
}

/** Every slot of a block cut to `widths`, row by row, left to right. */
export function layout(stage: number, widths: readonly number[]): Slot[] {
  const slots: Slot[] = [];
  for (let row = 0; row < formationRows(stage); row += 1) {
    const width = Math.min(FORM_COLS, widths[row] ?? FORM_COLS);
    const first = (FORM_COLS - width) / 2;
    for (let index = 0; index < width; index += 1) {
      slots.push({ col: first + index, row, index });
    }
  }
  return slots;
}

/** A row's slots, ordered from its centre outward, which is where a kind goes. */
function centreOut(slots: readonly Slot[], row: number): Slot[] {
  const centre = (FORM_COLS - 1) / 2;
  return slots
    .filter((slot) => slot.row === row)
    .sort(
      (left, right) =>
        Math.abs(left.col - centre) - Math.abs(right.col - centre) ||
        left.col - right.col,
    );
}

/** One drone of a wave: where it rests, what it is, and the band it carries. */
export interface WaveEntry {
  slot: Slot;
  kind: DroneKind;
  band: Band;
}

/**
 * Draw the wave for the current stage: its block, its Prisms, its Fluxes, the
 * escort either side of its anchor Prism, and the band every Shard carries.
 *
 * Every choice comes off the state's own generator, and the band of a mirror pair
 * is drawn once and mirrored to its opposite, so a formation always holds both
 * bands however the draw fell.
 */
export function composition(state: SpectraState): WaveEntry[] {
  const stage = state.stage;
  const pattern =
    ROW_PATTERNS[randomInt(state, 0, ROW_PATTERNS.length - 1)] ??
    ROW_PATTERNS[0];
  const slots = layout(stage, pattern);
  const kinds = new Map<Slot, DroneKind>();
  const bands = new Map<Slot, Band>();

  const priority: Slot[] = [];
  for (let row = 0; row < formationRows(stage); row += 1) {
    priority.push(...centreOut(slots, row));
  }

  let taken = 0;
  const prisms = Math.min(prismCount(stage), priority.length);
  while (taken < prisms) {
    const slot = priority[taken];
    if (slot !== undefined) kinds.set(slot, "prism");
    taken += 1;
  }

  // The anchor Prism's escort: the two Shards either side of it in its own row,
  // one of each band, so they travel in with it (`specs/drones.md`).
  const anchor = priority[0];
  const escorts =
    anchor === undefined
      ? []
      : slots.filter(
          (slot) =>
            slot.row === anchor.row && Math.abs(slot.col - anchor.col) === 1,
        );
  const escortLeadsCyan = random(state) < 0.5;
  escorts.forEach((slot, index) => {
    kinds.set(slot, "shard");
    const cyan = index === 0 ? escortLeadsCyan : !escortLeadsCyan;
    bands.set(slot, cyan ? "cyan" : "magenta");
  });

  const wanted = fluxCount(stage);
  const open = priority.filter((slot) => !kinds.has(slot));
  let placed = 0;
  while (placed < wanted && open.length > 0) {
    // A Flux is drawn from the slots nearest the centre of the block, so the
    // oscillators sit inside it rather than on its rim.
    const reach = Math.min(open.length, wanted + 3);
    const [slot] = open.splice(randomInt(state, 0, reach - 1), 1);
    if (slot !== undefined) kinds.set(slot, "flux");
    placed += 1;
  }

  // Every Shard's band, drawn once per mirror pair and mirrored to its opposite.
  for (const slot of slots) {
    if (bands.has(slot)) continue;
    const mirror = slots.find(
      (other) =>
        other.row === slot.row && other.col === FORM_COLS - 1 - slot.col,
    );
    const cyan = random(state) < 0.5;
    bands.set(slot, cyan ? "cyan" : "magenta");
    if (mirror !== undefined && mirror !== slot && !bands.has(mirror)) {
      bands.set(mirror, cyan ? "magenta" : "cyan");
    }
  }

  return slots.map((slot) => ({
    slot,
    kind: kinds.get(slot) ?? "shard",
    band: bands.get(slot) ?? "cyan",
  }));
}

/** Where the drone at `index` of the group entering on `row` comes down from. */
function entryPoint(row: number, index: number): { x: number; y: number } {
  const side = row % 2 === 0 ? 1 : -1;
  return {
    x: FORM_CENTER_X + side * ENTRY_SIDE_X,
    y: FIELD_TOP - ENTRY_LEAD - ENTRY_STACK * index,
  };
}

/** Return the wave's own clocks to their fresh-wave values. */
function freshWave(state: SpectraState): void {
  state.entryClock = 0;
  state.swayClock = 0;
  state.diveClock = 0;
  state.diveTarget = DIVE_FIRST_DELAY;
}

/** Build the standard wave for the current stage. */
function buildStandardWave(state: SpectraState): void {
  for (const entry of composition(state)) {
    const { slot } = entry;
    const at = entryPoint(slot.row, slot.index);
    const drone = addDroneTo(state, entry.kind, at.x, at.y);
    drone.band = entry.band;
    drone.phase = "entering";
    drone.slotX = slotX(slot.col);
    drone.slotY = slotY(slot.row);
    drone.entryGroup = slot.row;
    // A Flux's starting phase inside its band window is drawn from the game's
    // own generator, so a wave's Fluxes are not all on the same beat.
    if (entry.kind === "flux") {
      drone.bandClock = randomRange(state, 0, fluxWindowAt(state.stage));
    }
  }
}

/** Build the challenge flyover for the current stage. */
function buildChallengeWave(state: SpectraState): void {
  for (let group = 0; group < CHALLENGE_GROUPS; group += 1) {
    const rightward = group % 2 === 0;
    const band: Band = rightward ? "cyan" : "magenta";
    const x = rightward
      ? FIELD_LEFT - CHALLENGE_MARGIN
      : FIELD_RIGHT + CHALLENGE_MARGIN;
    for (let index = 0; index < CHALLENGE_PER_GROUP; index += 1) {
      const y = CHALLENGE_ROW0 + CHALLENGE_ROW_GAP * index;
      const drone = addDroneTo(state, "shard", x, y);
      drone.band = band;
      drone.phase = "entering";
      drone.slotX = x;
      drone.slotY = y;
      drone.entryGroup = group;
    }
  }
  state.challengeHits = 0;
}

/**
 * Build the wave for the current stage, which is what the stage-intro hold gives
 * way to. The roster is emptied first, so a wave is the whole of what stands.
 */
export function buildWave(state: SpectraState): void {
  state.drones = [];
  freshWave(state);
  if (isChallengeStage(state.stage)) buildChallengeWave(state);
  else buildStandardWave(state);
}
