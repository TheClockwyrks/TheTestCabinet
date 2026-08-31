// targets/ring3-destroyed-in-one-hit — a fresh ring 3 target falls to a
// single hit.
//
// WHAT THE SPECIFICATION FIXES. specs/rings.md's table gives ring 3 targets
// `1` hit point, and: "Each hit removes one hit point, and a target whose hit
// points reach zero is destroyed." with "A hit that brings them to zero
// destroys the target: the target is removed".
//
// THE WORLD IS ONE FROZEN RING'S LONE TARGET AND ONE BALL. The target is
// placed through the surface at the ring's own full figure — `spawnTarget`
// places it "exactly as a wave-start target does", so its hit points are the
// wave-start `1` the table states, read back before the crossing — and one
// posed ball crosses inward at its arc center. The driver switches are off
// (isolate), so the destruction sheds no pod and fires no clearing on top of
// the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertDefined, assertTrue } from "../assert";
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

const RING = 3;
const SLOT = 4;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes a fresh ring 3 target on a single hit", async () => {
  await isolate(h);
  await freezeRing(h, RING, 0);
  const fig = figures(RING);
  await placeTarget(h, RING, SLOT, fig.fullHp);

  const posed = targetAt(await h.snapshot(), RING, SLOT);
  assertDefined(posed, "the posed target");
  assertEqual(posed?.hp, 1, "a fresh ring 3 target's hit points");

  const removed = await captureReplay(h, "hit", async () => {
    await ballAt(
      h,
      fig.contactOuter + 5,
      arcCenterDeg(RING, SLOT, 0),
      -PROBE_SPEED,
      0,
    );
    const res = await h.until((s) => targetAt(s, RING, SLOT) === undefined, {
      maxTicks: 8,
    });
    await h.tick(8); // let the destruction read on the replay
    return res.hit;
  });

  assertTrue(
    removed,
    "one hit brings the 1-hit-point target to zero and removes it",
  );
});
