// growth/respawn-varies — the respawn cell is drawn rather than fixed.
//
// specs/board.md: "A pellet spawns at a uniformly random cell drawn from the
// valid set." A build that always answers the same cell satisfies every other
// rule of the valid set and makes an unplayable game: the route from one pellet
// to the next never changes, so the combo that specs/scoring.md builds the game
// around is a memorised loop.
//
// WHAT IS READ, AND WHY IT IS NOT A DISTRIBUTION. Randomness cannot be decided
// from a sample without a statistic, and a statistic over a build's own generator
// would fail a conformant build now and then. What the specification supports
// without qualification is that the draw MOVES: over twenty eats, the cells the
// game chose are not all one cell. That is the failure worth naming, and it is
// decided rather than estimated.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { driveEats } from "./eats";

/** Draws taken from the generator over the run. */
const EATS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places its pellets on more than one distinct cell", async () => {
  const run = await captureReplay(h, "varied", () =>
    driveEats(h, { eats: EATS }),
  );

  const distinct = new Set(
    run.placements.map(({ pellet }) => `${pellet.col},${pellet.row}`),
  );
  assertGreaterThan(
    distinct.size,
    1,
    `distinct cells across ${EATS} pellets the game placed`,
  );
});
