// campaign/maze-rating-tallies — the Maze Rating is the damage dealt to the Dynamo.
//
// specs/campaign.md: "Every point of damage dealt to it, direct hits and burn
// ticks alike, is added to the Maze Rating instead of removing health ... The
// Maze Rating is that total damage." specs/components.md keeps the other half of
// the equation: every firing structure keeps "the total damage it dealt", and
// "Burn damage counts toward the tallies of the structure that applied the
// burn."
//
// So the same damage is read twice, from the two ends, and the two must agree.
// The yard carries a Capacitor, whose shots are direct hits, and a Rectifier,
// whose shots also set a burn — so what the structures tally between them
// includes both kinds of point the rule names. The Maze Rating starts at `0`
// (specs/instrumentation.md's resting value, "before the finale") and what it
// rises by must be exactly what those two structures' tallies rose by.
//
// The Dynamo is reached through `spawnUnit` and its travel is held, so it stands
// in reach of both for the whole reading and nothing else on the yard can add a
// point to either total.
//
// THE WINDOW IS THE SAMPLE; THE FRAMES IT IS CUT INTO ARE NOT. The
// simulation is frame-division independent (`specs/controls.md`: "an interval of
// simulation time reaches the same state however it was divided into frames"), so
// the same window is driven at the COARSEST step this check may use. That
// step is bounded, and the bound is computed rather than guessed: a Capacitor's
// shot is a projectile, and a projectile that stepped more than `2 *
// PROJECTILE_HIT_R` between two frames could pass its target without ever coming
// within `PROJECTILE_HIT_R` of it. `MAX_STEP_MS` below is that bound out of the
// project's own transcription of `specs/components.md`, and the clock is the
// coarsest whole step inside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { PROJECTILE_HIT_R, PROJECTILE_SPEED } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  type Harness,
} from "../harness";

const GUN = { col: 10, row: 10 };
const BURNER = { col: 16, row: 10 };
const TARGET = { x: 280, y: 300 };

/**
 * The longest frame a bolt in flight is still readable on, in milliseconds.
 *
 * A shot travels at `PROJECTILE_SPEED` and lands when it is within
 * `PROJECTILE_HIT_R` of its target, so a frame that carried it further than the
 * diameter of that circle could step it straight over. Both figures come from
 * this project's `constants.ts`.
 */
const MAX_STEP_MS = (2 * PROJECTILE_HIT_R * 1000) / PROJECTILE_SPEED;

/** The rate this check runs at: the coarsest whole `5` ms step inside that bound. */
const WINDOW_HZ = 1000 / (Math.floor(MAX_STEP_MS / 5) * 5);

/** Five seconds: many cadences of both, and two full burn durations. */
const WINDOW_SECONDS = 5;

/** That window, in frames of this check's own clock. */
const WINDOW = WINDOW_SECONDS * WINDOW_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: WINDOW_HZ });
});

afterEach(() => {
  h.dispose();
});

it("raises the Maze Rating by exactly what the structures tallied", async () => {
  openYard(h);
  const gun = standComponent(h, "capacitor", 3, GUN.col, GUN.row);
  const burner = standComponent(h, "rectifier", 3, BURNER.col, BURNER.row);
  parkUnit(h, "overload", TARGET);

  const opening = h.snapshot();
  assertEqual(opening.mazeRating, 0, "the Maze Rating before any damage");
  const dealtBefore =
    structureById(opening, gun).damageDealt +
    structureById(opening, burner).damageDealt;

  await captureReplay(h, "rating", () => h.advance(WINDOW));

  const after = h.snapshot();
  const dealt =
    structureById(after, gun).damageDealt +
    structureById(after, burner).damageDealt -
    dealtBefore;

  assertGreaterThan(dealt, 0, "the two structures dealt damage to the Dynamo");
  assertGreaterThan(
    after.mazeRating,
    0,
    "the Maze Rating rose as the Dynamo took that damage",
  );
  assertCloseTo(
    after.mazeRating / dealt,
    1,
    3,
    `the Maze Rating of ${after.mazeRating} against the ${dealt} the ` +
      "structures tallied, direct hits and burn ticks alike",
  );
});
