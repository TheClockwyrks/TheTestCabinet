// Spectra — what a wave is made of, and where it comes in from
// (`specs/swarm.md`, `specs/stages.md`).
//
// A wave is built in the moment a stage's intro hold gives way, and the whole
// roster exists from that moment: every drone in phase `entering`, at its own
// starting point ABOVE the play field, so no drone stands inside the field when
// the wave opens. The wave then RELEASES them in groups, `ENTER_GROUP_GAP`
// apart, and a drone that has not been released holds its starting point.
//
// A STANDARD WAVE fills a rectangle of the slot grid that grows with the stage,
// which keeps three rules true by construction: the filled layout is
// mirror-symmetric about `FORM_CENTER_X`, it reads as a deliberate block rather
// than a scatter, and it can only grow up to the grid's capacity. The block
// holds one Prism with a two-Shard escort, at least two Fluxes, and Shards of
// both bands as the bulk of it; a later stage widens the block, deepens it, and
// leans further on Fluxes and Prisms.
//
// A CHALLENGE STAGE is not a wave at all. Its five groups of eight fly in from
// alternate sides as a line abreast — every drone of a group crossing into the
// field in the same instant, which is what makes a group a group a player can
// see — and each group carries one band, opposite to the group before it.

import {
  CHALLENGE_GROUPS,
  DIVE_FIRST_DELAY,
  CHALLENGE_PER_GROUP,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FORM_CENTER_X,
  FORM_COLS,
  FORM_ROWS,
  SLOT_DY,
  fluxWindow,
  isChallengeStage,
  slotX,
  slotY,
} from "./constants";
import { randomBetween, takeId, type MutDrone, type Sim } from "./sim";
import type { Band, DroneKind } from "./game";

/** How far outside the field's side a challenge group starts. */
export const CHALLENGE_MARGIN = 48;

/** How far out from its slot, above the field, an entering drone starts. */
const ENTER_START_OUT = 60;

/** How far above `FIELD_TOP` the first row's starts sit, and the stack between rows. */
const ENTER_START_GAP = 10;
const ENTER_START_STACK = 10;

/** The rows a challenge group's eight drones are spread down. */
const CHALLENGE_TOP = 130;
const CHALLENGE_ROW_GAP = 62;

/** One drone of a wave, before it is given an id. */
interface Placement {
  kind: DroneKind;
  band: Band;
  slotX: number;
  slotY: number;
  /** The group this drone is released with, before the groups are numbered. */
  group: number;
}

/** How many columns of the grid a standard wave at `stage` fills. */
export function waveCols(stage: number): number {
  return Math.min(FORM_COLS, 5 + 2 * Math.floor((stage - 1) / 2));
}

/** How many rows of the grid a standard wave at `stage` fills. */
export function waveRows(stage: number): number {
  return Math.min(FORM_ROWS, 3 + Math.floor((stage - 1) / 3));
}

/** How many Fluxes a standard wave at `stage` holds. */
export function waveFluxes(stage: number): number {
  return Math.min(6, 2 + 2 * Math.floor((stage - 1) / 3));
}

/** How many Prisms a standard wave at `stage` holds. */
export function wavePrisms(stage: number): number {
  return stage < 6 ? 1 : 2;
}

/** The columns a wave at `stage` fills, centred on the grid. */
function columns(stage: number): number[] {
  const cols = waveCols(stage);
  const first = Math.round((FORM_COLS - cols) / 2);
  return Array.from({ length: cols }, (_unused, i) => first + i);
}

/** Whether the column is filled by a wave at `stage`. */
function filled(stage: number, col: number): boolean {
  return columns(stage).includes(col);
}

/** The columns the Prisms of a wave at `stage` sit in, on the top row. */
function prismColumns(stage: number): number[] {
  return wavePrisms(stage) === 1 ? [4] : [2, 6];
}

/**
 * The columns a wave's Fluxes sit in, on the second row.
 *
 * Taken from the middle outward, so a wave that fills fewer columns still
 * places every Flux it holds, and the layout stays symmetric.
 */
function fluxColumns(stage: number): number[] {
  const preference = [3, 5, 2, 6, 1, 7];
  return preference
    .filter((col) => filled(stage, col))
    .slice(0, waveFluxes(stage));
}

/**
 * A standard wave's placements: one Prism per `prismColumns` with a Shard of
 * each band beside it, the Fluxes of the second row, and Shards everywhere else.
 *
 * The band of an ordinary Shard follows its column's parity, so the block always
 * holds both bands and the two alternate across it. The escorts are the one
 * exception: each Prism's pair is forced to opposite bands, which is what
 * `specs/drones.md` asks an escort to be.
 */
function standardPlacements(stage: number): Placement[] {
  const cols = columns(stage);
  const rows = waveRows(stage);
  const prisms = prismColumns(stage);
  const fluxes = fluxColumns(stage);

  // The group each placement rides in, before the empty groups are squeezed out:
  // the Prisms and their escorts first, then the Fluxes, then a group per row of
  // the Shards that are left.
  const ESCORT_GROUP = 0;
  const FLUX_GROUP = 1;
  const shardGroup = (row: number): number => 2 + row;

  const placements: Placement[] = [];
  const taken = new Set<string>();
  const claim = (col: number, row: number): void => {
    taken.add(`${col},${row}`);
  };

  for (const col of prisms) {
    placements.push({
      kind: "prism",
      band: col % 2 === 0 ? "cyan" : "magenta",
      slotX: slotX(col),
      slotY: slotY(0),
      group: ESCORT_GROUP,
    });
    claim(col, 0);
    // The escort: two Shards, one of each band, entering with the Prism.
    const escorts: [number, Band][] = [
      [col - 1, "cyan"],
      [col + 1, "magenta"],
    ];
    for (const [escortCol, band] of escorts) {
      if (!filled(stage, escortCol) || taken.has(`${escortCol},0`)) continue;
      placements.push({
        kind: "shard",
        band,
        slotX: slotX(escortCol),
        slotY: slotY(0),
        group: ESCORT_GROUP,
      });
      claim(escortCol, 0);
    }
  }

  for (const col of fluxes) {
    if (rows < 2) break;
    placements.push({
      kind: "flux",
      band: col % 2 === 0 ? "cyan" : "magenta",
      slotX: slotX(col),
      slotY: slotY(1),
      group: FLUX_GROUP,
    });
    claim(col, 1);
  }

  for (let row = 0; row < rows; row++) {
    for (const col of cols) {
      if (taken.has(`${col},${row}`)) continue;
      placements.push({
        kind: "shard",
        band: col % 2 === 0 ? "cyan" : "magenta",
        slotX: slotX(col),
        slotY: slotY(row),
        group: shardGroup(row),
      });
    }
  }

  return placements;
}

/**
 * A challenge stage's placements: `CHALLENGE_GROUPS` groups of
 * `CHALLENGE_PER_GROUP`, alternate groups entering from alternate sides, each
 * group one band and each band opposite the group before it.
 *
 * A challenge drone never settles, so its slot holds the point it entered at,
 * exactly as `specs/state.md` states.
 */
function challengePlacements(): Placement[] {
  const placements: Placement[] = [];
  for (let group = 0; group < CHALLENGE_GROUPS; group++) {
    const fromLeft = group % 2 === 0;
    const band: Band = group % 2 === 0 ? "cyan" : "magenta";
    const x = fromLeft
      ? FIELD_LEFT - CHALLENGE_MARGIN
      : FIELD_RIGHT + CHALLENGE_MARGIN;
    for (let i = 0; i < CHALLENGE_PER_GROUP; i++) {
      placements.push({
        kind: "shard",
        band,
        slotX: x,
        slotY: CHALLENGE_TOP + CHALLENGE_ROW_GAP * i,
        group,
      });
    }
  }
  return placements;
}

/**
 * Where a standard wave's drone starts its entrance, above the play field.
 *
 * Every start point is above `FIELD_TOP`, so no drone stands inside the field
 * when the wave opens, and each is close enough to it that a released drone
 * crosses into the field well inside a second however far its arc swings. The
 * row a drone is bound for stacks the starts, so a group arrives as a body
 * rather than as one point, and the side its slot is on offsets it, so the arc
 * it flies sweeps in from its own side of the block.
 */
export function entryStart(placement: { slotX: number; slotY: number }): {
  x: number;
  y: number;
} {
  const row = Math.max(0, Math.round((placement.slotY - slotY(0)) / SLOT_DY));
  const side = placement.slotX < FORM_CENTER_X ? -1 : 1;
  return {
    x: placement.slotX + side * ENTER_START_OUT,
    y: FIELD_TOP - ENTER_START_GAP - ENTER_START_STACK * row,
  };
}

/**
 * Build the stage's wave into `sim`: the whole roster, every drone entering, and
 * the wave's own clocks and schedule back at their fresh-wave values.
 */
export function buildWave(sim: Sim): void {
  const challenge = isChallengeStage(sim.stage);
  const placements = challenge
    ? challengePlacements()
    : standardPlacements(sim.stage);

  // Number the groups that actually hold a drone consecutively, so the wave
  // releases one group every `ENTER_GROUP_GAP` with no silent gap between two.
  const groups = [...new Set(placements.map((p) => p.group))].sort(
    (a, b) => a - b,
  );

  sim.drones = placements.map((placement): MutDrone => {
    const start = challenge
      ? { x: placement.slotX, y: placement.slotY }
      : entryStart(placement);
    return {
      id: takeId(sim),
      kind: placement.kind,
      x: start.x,
      y: start.y,
      band: placement.band,
      phase: "entering",
      phaseClock: 0,
      slotX: placement.slotX,
      slotY: placement.slotY,
      entryGroup: groups.indexOf(placement.group),
      bandClock: 0,
      shellAlive: true,
      shotsFired: 0,
      travel: true,
      oscillation: true,
      fire: true,
    };
  });

  // A Flux's starting phase is drawn from the game's own generator, so two waves
  // do not shimmer in lockstep and a player cannot learn one rhythm for good.
  for (const drone of sim.drones) {
    if (drone.kind !== "flux") continue;
    drone.bandClock = randomBetween(sim, 0, fluxWindow(sim.stage));
  }

  sim.entryClock = 0;
  sim.swayClock = 0;
  sim.diveClock = 0;
  sim.diveTarget = DIVE_FIRST_DELAY;
  sim.challengeHits = 0;
}
