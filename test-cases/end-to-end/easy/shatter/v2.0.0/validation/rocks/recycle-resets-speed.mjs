// Automated validation for the Rocks item `recycle-resets-speed`: a rock recycled by the
// star re-enters at a fresh base drift speed, so a rock slung through the well repeatedly
// never keeps accelerating. A rock is fired hard into the core (where gravity whips it to
// a high speed); once the star recycles it, the replacement's speed must be back in the
// base drift band, far below the peak it reached on the way in.
//
// Posing the rock on its way into the core is instant (`arrange`); the fall, the peak speed and
// the recycle are the behavior (`act`), so the clip is the whole slingshot. `actUntilRecycled`
// ticks one at a time because the peak has to be tracked across every sample and the recycle is
// detected between two of them.
//
// The 2 s the old drive allowed is 2 x 120 = 240 ticks.

import { newGame, actUntilRecycled, speedOf } from "../_helpers.mjs";

export default function item() {
  // Whether the rock was recycled, the state it re-entered in, and its peak speed.
  let outcome;

  return {
    id: "rocks.recycle-resets-speed",

    async arrange(api) {
      await newGame(api);
      await api.call("addRock", "small", { x: 640, y: 180, vx: 0, vy: 260 });
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
        "gravity whipped the rock to a high speed before recycling",
        outcome.peakSpeed,
        350,
      );
      check.expectLt(
        "the recycled rock re-enters at a modest base drift speed",
        recycledSpeed,
        300,
      );
      check.expectLt(
        "the recycle does not keep the slingshot speed",
        recycledSpeed,
        outcome.peakSpeed * 0.6,
      );
    },
  };
}
