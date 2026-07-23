// Automated validation for the Respawn item `critter-after-death`.
//
// After a death ends the crossing (with lives to spare), a fresh critter respawns on
// the near shore — on solid footing, with the crossing timer reset — not mid-strait
// and not on the water (specs/flow.md). A drowning is driven, then the respawn is read
// back: WHERE the fresh critter comes back. The bear's matching fairness is
// `hunter.fair-reset-death`. See validation/_helpers.mjs.

import { startCrossing, ROW_NEAR, WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // The respawn the death produced, for `assert` to read.
  let r;

  return {
    id: "respawn.critter-after-death",

    // Pose a death that ends the crossing: the critter over open water, three lives so
    // the run continues into a respawn rather than a game over.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setLane", 5, { cols: [] }); // open water -> drown
      await api.call("placeCritter", 20, 5);
    },

    // The death and the respawn it triggers — both what is checked and the clip.
    async act(api) {
      await api.until((s) => s.phase === "dying", { max: 120 }); // 1 s
      r = await api.until(
        (s) => s.phase === "crossing" && s.critter.row === ROW_NEAR,
        { max: 240, poll: 6 }, // 2 s — covers the death pause
      );
    },

    async assert(api, check) {
      check.expectOk("a fresh crossing begins after the death", r.hit);
      check.expectEq(
        "the critter respawns on the near shore",
        r.snap.critter.row,
        ROW_NEAR,
      );
      check.expectOk(
        "the respawn is above the water band, not in it",
        r.snap.critter.row > WATER_TOP,
      );
      check.expectEq(
        "the critter respawns on solid footing",
        r.snap.critter.footing,
        "solid",
      );
      check.expectEq("a life was spent on the death", r.snap.lives, 2);
      check.expectGt(
        "the crossing timer is reset for the fresh crossing",
        r.snap.timer,
        r.snap.timerMax - 1,
      );
    },
  };
}
