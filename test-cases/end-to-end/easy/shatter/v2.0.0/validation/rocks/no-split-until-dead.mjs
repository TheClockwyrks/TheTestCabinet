// Automated validation (Warhead) for the Rocks item (Warhead armor) `no-split-until-dead`: a non-fatal hit
// spends the bullet and lowers the rock's health but does NOT split it or score. A full-
// health Large is posed and struck once; the field must still hold that single Large, now at
// 2 health, with no score awarded.
//
// Posing the full-health Large is instant (`arrange`); placing the bullet and letting it fly
// into the rock is what consumes time (`act`). The clip carries on and finishes the rock off
// after the measurement, so a reviewer sees both halves of the rule: the first hit only chips
// it, the last one splits it.

import { newGame, actFireUntilGone, ROCK_RADIUS, TICK } from "../_helpers.mjs";

export default function item() {
  // The field the instant the single non-fatal bullet was spent, read by `assert`.
  let snap;

  return {
    id: "rocks.no-split-until-dead",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", 0);
      await api.call("addRock", "large", { x: 380, y: 220, vx: 0, vy: 0 });
    },

    async act(api) {
      // One real bullet into the full-health Large.
      const before = (await api.snapshot()).rocks[0];
      await api.call("addBullet", {
        x: before.x - (ROCK_RADIUS.large + 22),
        y: before.y,
        vx: 860,
        vy: 0,
      });
      // 84 ticks = the old 0.7 s cap; poll a single tick so the exact moment the bullet
      // is spent is read, not a state some way past it.
      await api.until((s) => s.bullets.length === 0, { max: 84, poll: TICK });
      snap = await api.snapshot();

      // Finish it off for a satisfying clip.
      await actFireUntilGone(api, "large");
    },

    async assert(api, check) {
      check.expectEq(
        "a non-fatal hit does not split the rock (still one Large)",
        snap.rocks.length,
        1,
      );
      check.expectEq(
        "the struck rock is still Large",
        snap.rocks[0] ? snap.rocks[0].size : "gone",
        "large",
      );
      check.expectEq(
        "a non-fatal hit lowers its health by one (3 -> 2)",
        snap.rocks[0] ? snap.rocks[0].health : -1,
        2,
      );
      check.expectEq("a non-fatal hit scores nothing", snap.score, 0);
    },
  };
}
