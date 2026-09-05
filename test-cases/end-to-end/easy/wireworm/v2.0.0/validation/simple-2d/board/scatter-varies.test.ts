// Wireworm — board/scatter-varies: the starting scatter is a draw, not a layout.
//
// specs/nodes.md: "The tiles are drawn from the run's seeded random generator, so
// a run's starting field is a fresh scatter rather than one fixed layout, and two
// runs from different seeds lay different fields." The whole board is the level
// in Wireworm — one field, twelve levels played over it — so a build that shipped
// one hand-placed layout would ship one game, played the same way every time.
//
// The reading is the SYMMETRIC DIFFERENCE of the two fields' occupied tiles: the
// tiles one run laid a node on and the other did not, either way round. What is
// asked of it is what the file states and nothing more — the two seeds lay
// DIFFERENT fields, so some tile is held by one and not the other. A build that
// laid the same layout twice measures `0`. HOW FAR two draws diverge is not a
// figure the file fixes, so no share of the tiles is asserted.
//
// Several pairs, because a build could differ on one pair by accident and be
// fixed everywhere else. Each pair is one draw of the same rule.
//
// The two runs of a pair differ ONLY in their seed — same build, same harness,
// same opening arrangement — so nothing but the draw can move the reading. The
// seeds are `reset`'s own argument, which specs/instrumentation.md states "seeds
// all of the game's randomness", so a build that seeded its generator as the
// surface specifies is the build this point can read at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { occupied, openRun } from "./scatter";

/** The seed pairs the comparison is read over. */
const PAIRS = [
  { first: 1, second: 2 },
  { first: 3, second: 4 },
  { first: 11, second: 29 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(PAIRS)(
  "lays different fields for seed $first and seed $second",
  async ({ first, second }) => {
    const before = occupied(await openRun(h, first));
    // The second seed's run is the one the still shows, so it is opened last.
    const after = occupied(await openRun(h, second));
    captureStill(h, "scatter");

    assertGreaterThan(
      before.size,
      0,
      `a run opened on seed ${first} lays a starting scatter (specs/nodes.md)`,
    );
    assertGreaterThan(
      after.size,
      0,
      `a run opened on seed ${second} lays a starting scatter (specs/nodes.md)`,
    );

    let differing = 0;
    for (const tile of before) if (!after.has(tile)) differing += 1;
    for (const tile of after) if (!before.has(tile)) differing += 1;

    assertGreaterThan(
      differing,
      0,
      `tiles occupied by one of the two scatters and not the other, from ` +
        `seeds ${first} and ${second} (specs/nodes.md: two runs from ` +
        `different seeds lay different fields); the two runs occupied ` +
        `${before.size} and ${after.size} tiles`,
    );
  },
);
