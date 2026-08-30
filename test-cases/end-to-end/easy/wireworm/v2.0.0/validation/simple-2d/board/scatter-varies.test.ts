// Wireworm — board/scatter-varies: the starting scatter is a draw, not a layout.
//
// specs/nodes.md: "The tiles are drawn from the run's seeded random generator, so
// a run's starting field is a fresh scatter rather than one fixed layout, and two
// runs from different seeds lay different fields." The whole board is the level
// in Wireworm — one field, twelve levels played over it — so a build that shipped
// one hand-placed layout would ship one game, played the same way every time.
//
// The reading is the SYMMETRIC DIFFERENCE of the two fields' occupied tiles: the
// tiles one run laid a node on and the other did not, either way round, as a
// fraction of how many tiles the two hold on average. A build that laid the same
// layout twice measures `0`. A build drawing two independent scatters over `680`
// tiles at a tenth to a seventh occupancy measures most of the way to `2`, since
// almost none of the two draws' tiles coincide.
//
// The two runs differ ONLY in their seed — same build, same harness, same opening
// arrangement — so nothing but the draw can move the reading. The seeds are
// `reset`'s own argument, which specs/instrumentation.md states "seeds all of the
// game's randomness", so a build that seeded its generator as the surface
// specifies is the build this point can read at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { occupied, openRun } from "./scatter";

/**
 * The two seeds, and the fraction of a scatter that has to differ between them.
 *
 * A tenth is the review item's figure, and it is a floor rather than an estimate:
 * two independent draws differ in nearly all of their tiles, so anything close to
 * this bound is a build varying its layout by nudging a handful of nodes.
 */
const FIRST_SEED = 1;
const SECOND_SEED = 2;
const DIFFER_MIN = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays different fields for two different seeds", async () => {
  const first = occupied(await openRun(h, FIRST_SEED));
  const second = occupied(await openRun(h, SECOND_SEED));
  captureStill(h, "scatter");

  assertGreaterThan(
    first.size,
    0,
    `a run opened on seed ${FIRST_SEED} lays a starting scatter ` +
      "(specs/nodes.md)",
  );
  assertGreaterThan(
    second.size,
    0,
    `a run opened on seed ${SECOND_SEED} lays a starting scatter ` +
      "(specs/nodes.md)",
  );

  let differing = 0;
  for (const tile of first) if (!second.has(tile)) differing += 1;
  for (const tile of second) if (!first.has(tile)) differing += 1;
  const fraction = differing / ((first.size + second.size) / 2);

  assertGreaterThan(
    fraction,
    DIFFER_MIN,
    `the fraction of occupied tiles that differ between the scatters seeds ` +
      `${FIRST_SEED} and ${SECOND_SEED} laid — ${differing} tiles held by one ` +
      `run and not the other, against ${first.size} and ${second.size} tiles ` +
      "occupied (specs/nodes.md: the tiles are drawn from the run's seeded " +
      "random generator)",
  );
});
