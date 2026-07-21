// Automated validation for the Scoring item `saucer-200`: destroying the saucer scores
// 200. A saucer is posed at rest clear of the star and a real bullet is fired into it;
// the score is read back once it is destroyed.
//
// Posing the saucer and the incoming bullet is instant (`arrange`); the bullet closing the gap
// and the collision scoring are the behavior (`act`), so the clip is the kill itself.
//
// The old drive stepped 40 x 0.01 s, which is 1.2 ticks a step — not a whole tick count. What it
// was really doing is "run until the saucer is gone, up to 0.4 s", so that is written directly:
// 48 ticks is the same 0.4 s budget, and a single-tick poll is strictly finer than the old
// sampling, so the score is read the instant the kill lands.

import { newGame, SAUCER_SCORE, TICK } from "../_helpers.mjs";

export default function item() {
  // The state once the saucer is gone (or the budget is spent), read by `assert`.
  let snap;

  return {
    id: "scoring.saucer-200",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", 0);
      await api.call("spawnSaucer");
      await api.call("setSaucer", { x: 300, y: 300, vx: 0, vy: 0 });
      await api.call("addBullet", { x: 250, y: 300, vx: 860, vy: 0 });
    },

    async act(api) {
      ({ snap } = await api.until((s) => s.saucer === null, {
        max: 48,
        poll: TICK,
      }));
    },

    async assert(api, check) {
      check.expectEq("the saucer is destroyed", snap.saucer, null);
      check.expectEq(
        "destroying the saucer scores 200",
        snap.score,
        SAUCER_SCORE,
      );
    },
  };
}
