// pods/kind-table — the second draw value picks the shed pod's kind by the
// fixed bands.
//
// specs/pods.md fixes the table over u2: widen on [0, 0.25), multiball on
// [0.25, 0.45), shield on [0.45, 0.65), pierce on [0.65, 0.80), and narrow on
// [0.80, 1). Each band is read off a fresh session's FIRST destruction, seeded
// (from the specification's own generator) so u1 sheds and u2 lands in that
// band — five seeds, one per band, so a build with one band wrong fails by the
// kind it drew rather than somewhere down a longer sequence.
//
// THE WORLD IS ONE TARGET AND ONE BALL PER DRAW, staged by the shared draw
// helper on a frozen ring 1 with the deflector parked away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { POD_DROP_CHANCE, mulberry32, podKindFor } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { AWAY_ANGLE, destroyPosedTarget } from "./draw";

/**
 * One seed per band of the kind table, first draw shedding: mulberry32 opens
 * 7 → u2 0.0620 (widen), 15 → 0.4041 (multiball), 8 → 0.6252 (shield),
 * 39 → 0.7530 (pierce), 9 → 0.8512 (narrow).
 */
const BAND_SEEDS = [7, 15, 8, 39, 9];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each kind from its band of u2", async () => {
  const expected: string[] = [];
  for (const seed of BAND_SEEDS) {
    const next = mulberry32(seed);
    const u1 = next();
    const u2 = next();
    assertTrue(u1 < POD_DROP_CHANCE, `seed ${seed}'s first draw sheds`);
    expected.push(podKindFor(u2));
  }
  // The five seeds cover the five bands, one each.
  assertEqual(new Set(expected).size, 5, "one seed per band of the table");

  for (const [i, seed] of BAND_SEEDS.entries()) {
    await isolate(h, seed);
    await h.debug.setPodSpawn(true);
    await h.debug.setPaddleAngle(AWAY_ANGLE);
    const after =
      i === 0
        ? await captureReplay(h, "band-draw", () => destroyPosedTarget(h, 1, 0))
        : await destroyPosedTarget(h, 1, 0);
    assertLength(after.pods, 1, `seed ${seed}'s first destruction sheds`);
    assertEqual(
      after.pods[0].kind,
      expected[i],
      `the kind u2 selects under seed ${seed}`,
    );
  }
});
