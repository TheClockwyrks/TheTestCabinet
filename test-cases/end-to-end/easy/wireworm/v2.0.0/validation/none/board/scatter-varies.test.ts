// Wireworm — board/scatter-varies: the starting scatter is not one fixed layout.
//
// specs/nodes.md, The starting field: "The tiles are drawn from the run's seeded
// random generator, so a run's starting field is a fresh scatter rather than one
// fixed layout, and two runs from different seeds lay different fields." That is
// what makes a run its own board rather than a level to be memorised, and it is
// the one property a hard-coded layout cannot fake.
//
// So two runs are opened from two different seeds, each the way a player opens
// one — `DESCEND` on the title (specs/ui.md) — and the two fields are compared
// as SETS OF TILES. What is counted is the tiles occupied by one scatter and not
// the other, against the review item's bound: more than a tenth of the tiles the
// two scatters occupy. A build with one fixed layout counts 0 and fails outright;
// a build that varies only a handful of tiles around a fixed field fails too.
//
// Several pairs, because a build could differ on one pair by accident and be
// fixed everywhere else. Each pair is one draw of the same rule.

import { afterEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startRunFromTitle,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/**
 * The share of the two scatters' tiles that has to differ, from the review
 * item: "differ in more than a tenth of their occupied tiles". Measured against
 * the mean of the two counts, so neither scatter's size alone sets the bar.
 */
const DIFFER_MIN_FRACTION = 0.1;

/** The seed pairs the comparison is read over. */
const PAIRS = [
  { first: 1, second: 2 },
  { first: 3, second: 4 },
  { first: 11, second: 29 },
];

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

/** The tiles a scatter occupies, as `"c,r"` keys. */
function occupied(snapshot: WirewormSnapshot): Set<string> {
  return new Set(snapshot.nodes.map((node) => `${node.c},${node.r}`));
}

/** A fresh run from `seed`, and the field it opened with. */
async function scatterFrom(seed: number): Promise<Set<string>> {
  const h = await createHarness();
  harnesses.push(h);
  await startRunFromTitle(h, { seed });
  await captureStill(h, "scatter");
  return occupied(await h.snapshot());
}

it.each(PAIRS)(
  "lays different fields from seed $first and seed $second",
  async ({ first, second }) => {
    // The second seed's run is the one the still shows, so it is opened last.
    const before = await scatterFrom(first);
    const after = await scatterFrom(second);

    assertGreaterThan(
      before.size,
      0,
      `a starting scatter to read, from seed ${first} (specs/nodes.md)`,
    );
    assertGreaterThan(
      after.size,
      0,
      `a starting scatter to read, from seed ${second} (specs/nodes.md)`,
    );

    const differing =
      [...before].filter((tile) => !after.has(tile)).length +
      [...after].filter((tile) => !before.has(tile)).length;

    assertGreaterThan(
      differing,
      (DIFFER_MIN_FRACTION * (before.size + after.size)) / 2,
      `tiles occupied by one of the two scatters and not the other, from ` +
        `seeds ${first} and ${second}`,
    );
  },
);
