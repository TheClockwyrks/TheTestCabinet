// waves/rings-refill-full — when the interstitial ends every slot of every
// ring refills with a full-hit-point target.
//
// specs/rings.md: "When it ends, every slot of every ring refills with a
// full-hit-point target" — 12 slots at 1 hp, 16 at 2, 20 at 1, per the ring
// table. The field is emptied through the surface before the interstitial so
// what the reading finds afterward can only be a refill.
//
// THE WORLD IS THE INTERSTITIAL OVER AN EMPTIED FIELD: a fresh session, its
// targets cleared, posed into waveclear and run out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WAVECLEAR_TICKS } from "../constants";
import {
  captureStill,
  openHarness,
  poseInterstitial,
  type Harness,
} from "../harness";
import { RINGS, totalTargets } from "./rig";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refills every slot of every ring at full hit points", async () => {
  h.reset();
  h.debug.setScreen("playing");
  h.debug.clearTargets();
  poseInterstitial(h);
  const emptied = h.snapshot();
  assertEqual(totalTargets(emptied), 0, "the field entering the interstitial");

  const after = await h.tick(WAVECLEAR_TICKS);
  captureStill(h, "refilled");

  assertEqual(after.screen, "playing", "the interstitial ran out");
  for (const [index, spec] of RINGS.entries()) {
    const ring = after.rings[index];
    const context = `ring ${index + 1}`;
    assertEqual(ring.targets.length, spec.slots, `${context}: every slot`);
    const slots = ring.targets
      .map((target) => target.slot)
      .sort((a, b) => a - b);
    for (let slot = 0; slot < spec.slots; slot += 1) {
      assertEqual(slots[slot], slot, `${context}: slot ${slot} filled`);
    }
    for (const target of ring.targets) {
      assertEqual(
        target.hp,
        spec.hitPoints,
        `${context}, slot ${target.slot}: full hit points`,
      );
    }
  }
});
