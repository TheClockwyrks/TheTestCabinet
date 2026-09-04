// targets/ring2-survives-first-hit — a fresh ring 2 target takes two hits: one
// leaves it live at 1 hit point, the second removes it.
//
// WHAT THE SPECIFICATION FIXES. specs/rings.md's table gives ring 2 targets
// `2` hit points, and: "Each hit removes one hit point, and a target whose hit
// points reach zero is destroyed."
//
// THE WORLD IS ONE FROZEN RING'S LONE TARGET AND ONE BALL PER HIT. Ring 2
// orbits at wave 1, so it is frozen (`setRingSpeed(2, 0)` holds until the next
// wave figure) and each hit is a fresh posed ball crossing inward at the arc's
// center — the second crossing is a fresh crossing, so it must land a fresh
// hit. The driver switches are off (isolate), so the final destruction sheds
// no pod and fires no clearing on top of the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertTrue } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  arcCenterDeg,
  ballAt,
  clearBalls,
  figures,
  freezeRing,
  placeTarget,
  PROBE_SPEED,
  targetAt,
} from "./rig";

const RING = 2;
const SLOT = 5;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a first-hit ring 2 target live at 1 hp, removes it on the second", async () => {
  await isolate(h);
  await freezeRing(h, RING, 0);
  const fig = figures(RING);
  await placeTarget(h, RING, SLOT, fig.fullHp);

  const posed = targetAt(await h.snapshot(), RING, SLOT);
  assertDefined(posed, "the posed target");
  assertEqual(posed?.hp, 2, "a fresh ring 2 target's hit points");

  const theta = arcCenterDeg(RING, SLOT, 0);
  const spawnR = fig.contactOuter + 5;
  const { first, second } = await captureReplay(h, "hits", async () => {
    await ballAt(h, spawnR, theta, -PROBE_SPEED, 0);
    const firstHit = await h.until(
      (s) => {
        const t = targetAt(s, RING, SLOT);
        return t === undefined || t.hp < 2;
      },
      { maxTicks: 8 },
    );
    await clearBalls(h);
    await ballAt(h, spawnR, theta, -PROBE_SPEED, 0);
    const secondHit = await h.until(
      (s) => targetAt(s, RING, SLOT) === undefined,
      { maxTicks: 8 },
    );
    await h.tick(8); // let the destruction read on the replay
    return { first: firstHit, second: secondHit };
  });

  assertTrue(first.hit, "the first crossing lands a hit");
  const afterFirst = targetAt(first.snapshot, RING, SLOT);
  assertDefined(afterFirst, "the target survives the first hit, still live");
  assertEqual(afterFirst?.hp, 1, "one hit point left after the first hit");
  assertTrue(second.hit, "the second hit brings it to zero and removes it");
});
