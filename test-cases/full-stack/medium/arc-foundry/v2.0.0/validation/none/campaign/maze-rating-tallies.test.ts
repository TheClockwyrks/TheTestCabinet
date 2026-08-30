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

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
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

/** Ten seconds: many cadences of both, and several burn durations. */
const WINDOW = 10 * 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the Maze Rating by exactly what the structures tallied", async () => {
  await openYard(h);
  const gun = await standComponent(h, "capacitor", 3, GUN.col, GUN.row);
  const burner = await standComponent(
    h,
    "rectifier",
    3,
    BURNER.col,
    BURNER.row,
  );
  await parkUnit(h, "overload", TARGET);

  const opening = await h.snapshot();
  assertEqual(opening.mazeRating, 0, "the Maze Rating before any damage");
  const dealtBefore =
    structureById(opening, gun).damageDealt +
    structureById(opening, burner).damageDealt;

  await captureReplay(h, "rating", () => h.advance(WINDOW));

  const after = await h.snapshot();
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
