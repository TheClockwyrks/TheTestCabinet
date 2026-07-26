// Automated validation for the Star-core item `ship-slides`: the star's core is solid
// but not lethal — flying into it costs no life; the ship slides along the surface
// rather than through it. With invulnerability cleared (so a lethal hit WOULD register)
// and the field emptied, the ship is driven straight into the core; the real collision
// code must keep it out of the core, cost no life, and keep the game playing.
//
// Posing the ship on its collision course is instant (`arrange`); the impact and the slide are
// the behavior (`act`), so the clip is the ship riding the core surface.
//
// The sweep stays a LOOP because it tracks how far INTO the core the ship ever gets, which a
// single long advance would step straight over. The old drive ran 30 x 0.02 s = 0.6 s; 0.02 s is
// 2.4 ticks, which is not a whole tick count, so this samples every SINGLE tick instead and runs
// 72 of them — the same 0.6 s budget at strictly finer resolution, so no penetration is missed.

import {
  newGame,
  poseShip,
  distToStar,
  CORE_R,
  SHIP_R,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  // The closest the ship ever got to the star, and the state it came to rest in.
  let minD;
  let snap;

  const surface = CORE_R + SHIP_R; // 44 — the ship rides the core surface, never inside

  return {
    id: "star-core.ship-slides",

    async arrange(api) {
      await newGame(api);
      await api.call("setInvuln", 0); // collisions are live: the core is proven non-lethal on its own
      await poseShip(api, {
        x: 640,
        y: 420,
        vx: 0,
        vy: -300,
        angle: -Math.PI / 2,
      });
    },

    async act(api) {
      minD = distToStar((await api.snapshot()).ship);
      for (let i = 0; i < 72; i += 1) {
        await api.advance(TICK);
        minD = Math.min(minD, distToStar((await api.snapshot()).ship));
      }
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectGe(
        "the ship never penetrates the core (stays at/beyond the surface)",
        minD,
        surface - 1,
      );
      check.expectClose(
        "the ship comes to rest sliding on the core surface",
        distToStar(snap.ship),
        surface,
        1.5,
      );
      check.expectEq("flying into the core costs no life", snap.lives, 3);
      check.expectEq(
        "the game keeps playing (the core is not lethal)",
        snap.screen,
        "playing",
      );
    },
  };
}
