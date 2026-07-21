// Automated validation for the Rocks item `fragment-fan`: split fragments fan apart to
// opposite sides based on the shot direction and inherit the parent's motion. A Large
// rock drifting LEFTWARD (against the star's rightward pull) is destroyed with a
// horizontal shot; the two fragments must fan to opposite vertical sides and both keep
// the parent's leftward drift (which gravity alone could not produce).
//
// Posing the leftward-drifting parent is instant (`arrange`); the horizontal shot and the fan
// it produces are the behavior (`act`), so the clip shows the fragments spring apart.

import { arrangePosedRock, actFireUntilGone } from "../_helpers.mjs";

export default function item() {
  // The field just after the Large died, read by `assert`.
  let outcome;

  return {
    id: "rocks.fragment-fan",

    // Parent drifts left; the shot is horizontal, so the split kick is vertical.
    async arrange(api) {
      await arrangePosedRock(api, "large", { x: 520, y: 250, vx: -80, vy: 0 });
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "large");
    },

    async assert(api, check) {
      const frags = outcome.snap.rocks.filter((r) => r.size === "medium");

      check.expectEq("the Large split into two fragments", frags.length, 2);
      if (frags.length === 2) {
        check.expectLt(
          "the fragments fan to opposite vertical sides of the shot",
          frags[0].vy * frags[1].vy,
          0,
        );
        check.expectGt(
          "one fragment kicks well off-axis",
          Math.abs(frags[0].vy),
          40,
        );
        check.expectGt(
          "the other fragment kicks the opposite way",
          Math.abs(frags[1].vy),
          40,
        );
        check.expectLt(
          "both fragments inherit the parent's leftward drift",
          frags[0].vx,
          -20,
        );
        check.expectLt(
          "both fragments inherit the parent's leftward drift",
          frags[1].vx,
          -20,
        );
      }
    },
  };
}
