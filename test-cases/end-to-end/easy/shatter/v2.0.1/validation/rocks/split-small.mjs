// Automated validation for the Rocks item `split-small`: a Small rock is destroyed outright,
// leaving no fragment. A single Small is posed and shot once; nothing must be left of it.
//
// What "nothing is left of it" is measured against is a BYSTANDER rock, parked out of the way
// and never shot, rather than an empty field. Reading the field empty was the natural way to
// say this and it was wrong: destroying the last rock on the field clears the wave, and the
// game then spawns the next one — five Large rocks — right where the check is looking. So the
// item read five rocks and called it a Small that had shattered into fragments. The bystander
// means the field is never empty, no wave can clear, and the count is a real measurement: one
// rock left is the bystander alone and the Small left nothing, three would be the bystander
// plus two fragments. Asserting the bystander is still there is what says the drive ran on the
// field this item posed. See `arrangeBystanderRock` in `_helpers.mjs`.
//
// Exactly one bullet is fired, through `actFireOneShotAt`. A helper that keeps shooting while
// a Small is on the field would, on a build where a Small wrongly splits, shoot the fragments
// down too and leave the same clean field a correct build leaves.
//
// Posing the rocks is instant (`arrange`); the shot is what consumes time (`act`), so the clip
// is the hit and what it leaves behind.

import {
  newGame,
  arrangeBystanderRock,
  actFireOneShotAt,
} from "../_helpers.mjs";

const TARGET = { x: 380, y: 220 }; // the Small under test, on a clear left-to-right lane

export default function item() {
  // The field just after the Small was hit, read by `assert`.
  let outcome;

  return {
    id: "rocks.split-small",

    async arrange(api) {
      await newGame(api);
      await api.call("addRock", "small", { ...TARGET, vx: 0, vy: 0 });
      await arrangeBystanderRock(api);
    },

    async act(api) {
      outcome = await actFireOneShotAt(api, TARGET);
    },

    async assert(api, check) {
      const rocks = outcome.snap.rocks;
      check.expectOk("the shot is spent on the Small", outcome.spent.hit);
      check.expectEq(
        "the Small is gone",
        rocks.filter((r) => r.size === "small").length,
        0,
      );
      check.expectEq(
        "a destroyed Small leaves no fragments — only the untouched bystander remains",
        rocks.length,
        1,
      );
      check.expectEq(
        "and that one rock is the bystander, so the field never emptied under the check",
        rocks[0]?.size,
        "large",
      );
    },
  };
}
