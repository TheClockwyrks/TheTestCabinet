// Automated validation (Warhead) for the Homing-torpedo item `one-hit-medium`: a torpedo
// destroys a Medium rock in one hit regardless of its armor, splitting and scoring like a bullet
// kill. A full-health Medium (which the primary gun would need two hits for) is placed ahead and
// a single torpedo launched at it; the real impact code must destroy it outright.
//
// Posing the ship, the armored Medium and the readied charge is instant (`arrange`); the launch
// and the impact are the behavior (`act`). The sweep runs to 2 s x 120 Hz = 240 ticks and polls
// a single tick so the field is read the instant the torpedo is spent, before the fragments
// drift apart.

import { newGame, poseShip, ROCK_SCORE, TICK } from "../_helpers.mjs";

export default function item() {
  // The field the instant the torpedo was spent, read by `assert`.
  let snap;

  return {
    id: "torpedo.one-hit-medium",

    // Pose the ship and target along the top of the field, clear of the central star.
    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("setScore", 0);
      await poseShip(api, { x: 200, y: 150, vx: 0, vy: 0, angle: 0 });
      await api.call("addRock", "medium", { x: 600, y: 150, vx: 0, vy: 0 }); // full-health Medium, dead ahead
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      ({ snap } = await api.until((s) => s.torpedoes.length === 0, {
        max: 240,
        poll: TICK,
      }));
    },

    async assert(api, check) {
      check.expectEq("the single torpedo is spent on the hit", snap.torpedoes.length, 0);
      check.expectEq(
        "one torpedo destroys the full-health Medium (armor ignored)",
        snap.rocks.filter((r) => r.size === "medium").length,
        0,
      );
      check.expectEq(
        "the destroyed Medium splits into two Small rocks",
        snap.rocks.filter((r) => r.size === "small").length,
        2,
      );
      check.expectEq(
        "the torpedo kill scores the Medium's 50 points",
        snap.score,
        ROCK_SCORE.medium,
      );
    },
  };
}
