// Automated validation for progression.bonus-life: crossing a 12,000-point milestone
// through real scoring grants a bonus life.
//
// The score is set just below the milestone as a precondition; a real +score event
// (shooting a worm head for 100) crosses 12,000 through the real addScore path, which
// grants the life. The life gain is read back — nothing fabricates it.

import {
  actFireAndResolve,
  freshBoard,
  setWorm,
  straightWorm,
  tileCX,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;

  return {
    id: "progression.bonus-life",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 3);
      await api.call("setScore", 11990); // just below the 12,000 milestone
      await setWorm(api, straightWorm(20, 15, 3, 1), 1, 1); // head at column 20
      await api.call("setCursor", tileCX(20), 688);
    },

    // The shot that crosses the milestone is the clip: the reviewer watches the HUD
    // tick past 12,000 and a life appear.
    async act(api) {
      before = (await api.snapshot()).lives;
      snap = await actFireAndResolve(api);
      // Every operand is captured; the sim runs on only so the extra life is legible
      // in the HUD at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("three lives before the milestone", before, 3);
      check.expectGe(
        "real scoring crossed the 12,000 milestone",
        snap.score,
        12000,
      );
      check.expectEq("crossing 12,000 grants a bonus life", snap.lives, 4);
    },
  };
}
