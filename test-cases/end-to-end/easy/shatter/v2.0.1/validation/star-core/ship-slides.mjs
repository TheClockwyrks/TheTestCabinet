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
// single long advance would step straight over. It samples every SINGLE tick, so no
// penetration is missed, and runs 150 of them (1.25 s) — long enough that the ship makes the
// run in from 200 px out under its own momentum and then rides the surface for a beat, which
// is what the clip has to show. The old 0.6 s budget started the ship 60 px off the core, so
// the contact was over before the recording had a frame of the approach.
//
// The life count is compared against the one read BEFORE the impact, not against a fixed
// number. "Flying into the core costs no life" is a statement about a difference, and the
// absolute count is not one the case can assert: `specs/instrumentation.md` calls `lives`
// "ships in reserve" while `specs/gameplay.md` counts three ships in total, so a fresh game
// legitimately reports either 2 or 3 (see `_helpers.mjs`).

import {
  newGame,
  poseShip,
  distToStar,
  CORE_R,
  SHIP_R,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  // The life count going in, the closest the ship ever got, and the state it rested in.
  let livesBefore;
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
        y: 560,
        vx: 0,
        vy: -300,
        angle: -Math.PI / 2,
      });
      livesBefore = (await api.snapshot()).lives;
    },

    async act(api) {
      minD = distToStar((await api.snapshot()).ship);
      for (let i = 0; i < 150; i += 1) {
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
      check.expectEq(
        "flying into the core costs no life",
        snap.lives,
        livesBefore,
      );
      check.expectEq(
        "the game keeps playing (the core is not lethal)",
        snap.screen,
        "playing",
      );
    },
  };
}
