// Automated validation (Warhead) for the Recycle-armor item `resets-speed`: even though a
// recycle preserves a rock's health, it still resets the rock's move speed to a fresh base
// drift, so a rock slung through the star repeatedly does not keep getting faster. A damaged
// Large is fired hard into the core; the recycled rock's speed must be back in the base band,
// far below the peak it reached on the way in.
//
// Posing the damaged Large on its way into the core is instant (`arrange`); the fall, the peak
// speed gravity whips it to, and the recycle are the behavior (`act`), so the clip is the whole
// slingshot. `actUntilRecycled` ticks one at a time because the peak has to be tracked across
// every sample and the recycle detected between two of them.
//
// The 2 s the old drive allowed is 2 x 120 = 240 ticks.

import { newGame, actUntilRecycled, speedOf } from "../_helpers.mjs";

export default function item() {
  // Whether the rock was recycled, the state it re-entered in, and its peak speed.
  let outcome;

  return {
    id: "recycle-armor.resets-speed",

    async arrange(api) {
      await newGame(api);
      await api.call("addRock", "large", {
        x: 640,
        y: 180,
        vx: 0,
        vy: 240,
        health: 2,
      });
    },

    async act(api) {
      outcome = await actUntilRecycled(api, { maxTicks: 240 });
    },

    async assert(api, check) {
      const recycledSpeed = outcome.recycled
        ? speedOf(outcome.snap.rocks[0])
        : 0;

      check.expectOk("the rock was recycled by the star", outcome.recycled);
      check.expectGt(
        "gravity whipped it to a high speed before recycling",
        outcome.peakSpeed,
        300,
      );
      check.expectLt(
        "the recycled rock re-enters at a modest base drift speed",
        recycledSpeed,
        260,
      );
      check.expectLt(
        "repeated slinging cannot keep accelerating it",
        recycledSpeed,
        outcome.peakSpeed * 0.6,
      );
    },
  };
}
