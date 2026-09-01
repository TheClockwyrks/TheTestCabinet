// Wick — oil-splash/scatter-varies: puddles land at random points.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): each
// puddle is "centered at an independent uniformly random point of the disk of
// radius `OIL_SCATTER` (`400`) about the player's center". `specs/overview.md`
// ("Units, ticks, the world, and the camera"): "The game holds one seeded
// pseudo-random generator, and every random choice this specification names
// draws from it", and `specs/instrumentation.md` ("A deterministic core")
// lists "a puddle's landing point" among the draws and has `reset` seed the
// generator. Two readings follow. Twenty independent draws from one seed land
// at more than one point, because a draw that always lands at one point is no
// draw from a disk. And the first draw from a different seed lands somewhere
// else, because a generator whose first landing point is the same under every
// seed is not seeded.
//
// WHAT IS READ. The centers of the puddles twenty level-1 firings create from
// `DEFAULT_SEED`, counted as distinct points; then the center of the one
// puddle the first level-1 firing creates from a second seed, against the
// first landing of the first seed. Level 1 fires one puddle, so each firing is
// one draw.
//
// THE POSE. An isolated night from `DEFAULT_SEED` with Oil Splash alone at
// level 1, fired through the shared `fireOil` and then nineteen times more
// through `refireOil`; then a fresh isolated night from `OTHER_SEED`, the same
// operations in the same order, fired once. Nothing else runs and no enemy is
// posed, so the puddles pulse on nothing.
//
// TOLERANCE. Two centers are one point when they are within `POSITION_TOL`, so
// a build that reports its positions rounded to the unit still counts a
// repeated point as repeated. The probability that two genuine draws from a
// disk of radius `400` coincide within a millionth of a unit is nil.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { DEFAULT_SEED } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import {
  centerOf,
  distinctPoints,
  fireOil,
  puddlesOf,
  refireOil,
  samePoint,
} from "./stage";

/** The level fired: row 1, one puddle a firing, one draw a firing. */
const LEVEL = 1;

/** How many firings are read from the first seed, as the review item states. */
const FIRINGS = 20;

/** A seed other than the default the first run is posed from. */
const OTHER_SEED = DEFAULT_SEED + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands twenty puddles at more than one point, and a different seed's first puddle elsewhere", async () => {
  await isolate(h, { seed: DEFAULT_SEED });
  const landings: { x: number; y: number }[] = [];
  let fired = await fireOil(h, LEVEL);
  for (let index = 0; index < FIRINGS; index += 1) {
    if (index > 0) fired = await refireOil(h, fired.slot);
    const puddles = puddlesOf(fired);
    assertGreaterThan(
      puddles.length,
      0,
      `Oil Splash puddles firing ${index} of seed ${DEFAULT_SEED} created`,
    );
    landings.push(centerOf(puddles[0]!));
  }
  await captureStill(h, "random");

  await isolate(h, { seed: OTHER_SEED });
  const other = puddlesOf(await fireOil(h, LEVEL));
  assertGreaterThan(
    other.length,
    0,
    `Oil Splash puddles the first firing of seed ${OTHER_SEED} created`,
  );

  assertEqual(
    landings.length,
    FIRINGS,
    "landing points read from the first seed",
  );
  assertGreaterThan(
    distinctPoints(landings).length,
    1,
    `distinct landing points among ${FIRINGS} firings from seed ${DEFAULT_SEED}`,
  );
  const first = landings[0]!;
  const otherFirst = centerOf(other[0]!);
  assertTrue(
    !samePoint(first, otherFirst),
    `the first landing point of seed ${OTHER_SEED}, (${otherFirst.x}, ${otherFirst.y}), differs from seed ${DEFAULT_SEED}'s, (${first.x}, ${first.y})`,
  );
});
