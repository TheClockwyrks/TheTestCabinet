// Automated validation for the Targeting sub-item `first-along-path`.
//
// An emitter fires on the unit furthest along its path (closest to leaking) first,
// rather than the nearest one (specs/towers.md). We let one Hulk get ahead, then
// spawn a second behind it, both in an Arc's range; the leading Hulk takes damage
// while the trailing one is untouched.

import { newGame, build, spawn, unit } from "../_helpers.mjs";

export default function item() {
  let lead;
  let l;
  let t;

  return {
    id: "targeting.first-along-path",

    // A hot Arc covering the lane, and the first Hulk released into it. Hulks are
    // used because they are tanky enough to survive being shot at while the second
    // one catches up.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const arc = await build(api, "arc", 5, 17);
      await api.call("setHeat", arc, 80);
      lead = await spawn(api, "hulk", "left");
    },

    // Let the leader get genuinely ahead (720 ticks = the old 12s cap, polled every 6
    // ticks — the old 0.1s chunk), then release the trailing Hulk into the same range
    // and fire for 60 ticks (the old 1s). Which of the two takes damage is the check.
    async act(api) {
      await api.until((s) => s.surge.some((u) => u.id === lead && u.x > 130), {
        max: 720,
        poll: 6,
      });
      const trail = await spawn(api, "hulk", "left");
      await api.advance(60);

      l = await unit(api, lead);
      t = await unit(api, trail);
    },

    async assert(api, check) {
      check.expectOk("both Hulks are on the floor", l !== null && t !== null);
      check.expectLt(
        "the leading Hulk (furthest along) took damage first",
        l.hp,
        l.maxHp,
      );
      check.expectClose(
        "the trailing Hulk is still untouched",
        t.hp,
        t.maxHp,
        0.01,
      );
    },
  };
}
