// targets/ring2-survives-first-hit — a fresh ring 2 target's first hit leaves it
// live at one hit point.
//
// specs/rings.md's table gives ring 2 targets `2` hit points, and: "Each hit
// removes one hit point, and a target whose hit points reach zero is destroyed."
// This point is the survival; that a SECOND hit fells it is
// `ring2-falls-to-second-hit`, so a build that takes the wrong number of hit
// points off per hit and one that never destroys are told apart.
//
// THE WORLD IS ONE FROZEN RING'S LONE TARGET AND ONE BALL. Ring 2 orbits at wave
// 1, so it is frozen (`setRingSpeed(2, 0)` holds until the next wave figure) and
// the hit is one posed ball crossing inward at the arc's center. The driver
// switches are off (isolate), so nothing sheds or clears on top of the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertTrue } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  arcCenterDeg,
  ballAt,
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

it("leaves a first-hit ring 2 target live at 1 hit point", async () => {
  await isolate(h);
  await freezeRing(h, RING, 0);
  const fig = figures(RING);
  await placeTarget(h, RING, SLOT, fig.fullHp);

  const posed = targetAt(await h.snapshot(), RING, SLOT);
  assertDefined(posed, "the posed target");
  assertEqual(posed?.hp, 2, "a fresh ring 2 target's hit points");

  const theta = arcCenterDeg(RING, SLOT, 0);
  const first = await captureReplay(h, "first-hit", async () => {
    await ballAt(h, fig.contactOuter + 5, theta, -PROBE_SPEED, 0);
    const landed = await h.until(
      (s) => {
        const t = targetAt(s, RING, SLOT);
        return t === undefined || t.hp < 2;
      },
      { maxTicks: 8 },
    );
    await h.tick(4); // let the hit read on the replay
    return landed;
  });

  assertTrue(first.hit, "the first crossing lands a hit");
  const afterFirst = targetAt(first.snapshot, RING, SLOT);
  assertDefined(afterFirst, "the target survives the first hit, still live");
  assertEqual(afterFirst?.hp, 1, "one hit point left after the first hit");
});
