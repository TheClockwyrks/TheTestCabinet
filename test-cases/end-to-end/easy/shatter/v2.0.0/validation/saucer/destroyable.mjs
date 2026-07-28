// Automated validation for the Saucer item `destroyable`: the saucer can be shot down
// with a bullet, for points. A saucer is posed at rest clear of the star and a real
// bullet is fired into it; the real collision code must remove it and award its score.
//
// Posing the saucer and the incoming bullet is instant (`arrange`); the bullet closing the gap
// and the collision resolving are the behavior (`act`), so the clip is the kill itself.
//
// The shot is taken through `actShootDownSaucer`, which stands the round off far enough to be
// seen crossing to its target and re-aims if it misses. The 50 px gap it replaces resolved
// inside a couple of frames, so the recording — which films `act` — was over before the bullet
// had been drawn anywhere. Re-aiming is what lets that longer run be safe: the saucer is a
// powered craft that weaves and steers around the star (`specs/hazards.md`), so where it will
// be when the bullet arrives is the build's business, not something this script may assume.

import { newGame, actShootDownSaucer, SAUCER_SCORE } from "../_helpers.mjs";

export default function item() {
  // The state once the saucer is gone (or the budget is spent), read by `assert`.
  let snap;

  return {
    id: "saucer.destroyable",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", 0);
      await api.call("spawnSaucer");
      await api.call("setSaucer", { x: 400, y: 250, vx: 0, vy: 0 }); // well clear of the star
    },

    async act(api) {
      ({ snap } = await actShootDownSaucer(api));
      await api.advance(72); // 0.6 s tail, so the clip carries past the kill
    },

    async assert(api, check) {
      check.expectEq("a bullet shoots the saucer down", snap.saucer, null);
      check.expectEq(
        "shooting the saucer scores 200",
        snap.score,
        SAUCER_SCORE,
      );
    },
  };
}
