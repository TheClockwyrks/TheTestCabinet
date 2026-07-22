// Automated validation (Warhead) for the Homing-torpedo item `destroyed-by-star`: a torpedo is
// absorbed and removed if it reaches the star core (specs/mode-warhead.md). With no targets on
// the field, a torpedo is launched straight at the star; it must fly into the core and be
// removed there, scoring nothing.
//
// The cleared field, the ship's pose aimed at the star and the readied charge are the
// preconditions (`arrange`); the launch and the flight into the core are the behavior (`act`),
// so the clip is the torpedo vanishing into the star. The sweep ticks one at a time (tracking
// the closest the torpedo came to the star) because the removal is detected between two
// consecutive samples. The 180-tick cap (1.5 s) is well under the torpedo's 3.5 s lifetime, so a
// removal within it is the core taking it, not the torpedo expiring.

import { newGame, poseShip, distToStar, TICK } from "../_helpers.mjs";

export default function item() {
  // Whether the torpedo was removed, the closest it came to the star, and the final score.
  let removed;
  let minDist;
  let score;

  return {
    id: "torpedo.destroyed-by-star",

    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("removeSaucer");
      await api.call("setScore", 0);
      await poseShip(api, { x: 200, y: 360, vx: 0, vy: 0, angle: 0 }); // aimed straight at the core
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      removed = false;
      minDist = Infinity;
      for (let i = 0; i < 180; i += 1) {
        const s = await api.snapshot();
        const t = s.torpedoes[0];
        if (!t) {
          removed = true;
          score = s.score;
          break;
        }
        minDist = Math.min(minDist, distToStar(t));
        await api.advance(TICK);
      }
      if (!removed) score = (await api.snapshot()).score;
    },

    async assert(api, check) {
      check.expectOk(
        "the torpedo is removed within its flight time (by the core, not by expiring)",
        removed,
      );
      check.expectLt(
        "it flew into the star core before it was removed",
        minDist,
        60,
      );
      check.expectEq("absorbing a torpedo at the core scores nothing", score, 0);
    },
  };
}
