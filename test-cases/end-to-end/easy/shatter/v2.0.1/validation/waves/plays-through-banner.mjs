// Automated validation for the Waves item `plays-through-banner`: the WAVE N banner is a
// breather from ROCKS, not a pause. `specs/gameplay.md` says so in as many words — "The ship
// keeps flying throughout, so the player gets that beat to reposition" — and everything else
// on the field is bound by the same sentence: the game is still running, it simply has no
// rocks on it yet.
//
// WHAT THIS CATCHES. A build that reads "the field stays clear for the whole of it" as
// permission to stop simulating gets away with it everywhere else, because during a banner
// there are no rocks to freeze and nothing to notice. The saucer is the exception: it has its
// own cadence (`specs/hazards.md` — one every 25 to 35 seconds, and it despawns on distance,
// time or being shot), and nothing ties it to wave boundaries, so it is routinely still hunting
// when the last rock dies. A build that skips its movement and collision passes during the
// banner leaves the saucer hanging motionless and impossible to shoot down for a second and
// a half at the end of every wave, and lets its bullets sail through the ship. That is
// ordinary play, so it is graded here rather than left to trip up items whose subject is
// something else.
//
// HOW THE BANNER IS REACHED. `newGame` leaves the field empty, and an empty field is a
// cleared wave, so the first step of `act` raises the banner on its own — no rock has to be
// shot to get there. The saucer and a moving ship are posed first, while the clock is still
// manual, so both are already under way when the beat begins.
//
// THE WINDOW IS KEPT SHORT ON PURPOSE. Everything measured has to happen while the banner is
// still up, or it is a reading of ordinary play wearing a banner's name. The whole drive is
// about 0.45 s against a banner the spec puts at "about 1.5 s", and the banner is re-read at
// the end to confirm it never lapsed mid-measurement.

import { newGame, SAUCER_CRUISE, TICK, ticks, hyp } from "../_helpers.mjs";

// Posed clear of the star and of each other, and slow enough that neither crosses an edge
// inside the window.
const SHIP_POSE = { x: 200, y: 120, vx: 220, vy: 0, angle: 0 };
const SAUCER_POSE = { x: 900, y: 600, vx: -SAUCER_CRUISE, vy: 0 };

const MOVE_TICKS = 36; // 0.3 s of banner to watch both bodies travel through
const SHOT_TICKS = 18; // and long enough for a point-blank round to reach the saucer
const MIN_TRAVEL = 20; // logical px — a body that is being simulated clears this easily
const STANDOFF = 40; // where the round is placed, on the side the saucer is heading toward
const ROUND_SPEED = 600;
const DWELL = 90; // clip only: hold on the transition so the wave is seen arriving

/**
 * Mark an unmet precondition. A plain property rather than a shared class because this file is
 * loaded by path (see `PRECONDITION_UNMET` in `packages/browser-driver/validation.mjs`).
 */
function unmetPrecondition(reason) {
  const err = new Error(reason);
  err.ttcPreconditionUnmet = true;
  return err;
}

export default function item() {
  let raised;
  let shipTravel;
  let saucerTravel;
  let killed;
  let stillBanner;

  return {
    id: "waves.plays-through-banner",

    async arrange(api) {
      await newGame(api); // clears the field, so the first step of `act` clears a wave
      await api.call("setShip", SHIP_POSE);
      await api.call("spawnSaucer");
      await api.call("setSaucer", SAUCER_POSE);
    },

    async act(api) {
      // The empty field raises the banner on the first step.
      raised = await api.until((s) => s.waveBanner, {
        max: ticks(2),
        poll: TICK,
      });
      if (!raised.hit) {
        throw unmetPrecondition(
          "clearing the field raised no WAVE banner, so there is no banner to play through",
        );
      }
      const start = raised.snap;
      if (!start.saucer) {
        throw unmetPrecondition(
          "the saucer left the field as the wave cleared, so there is nothing on it whose " +
            "motion the banner could be watched through",
        );
      }

      // Does the world move while the banner is up?
      await api.advance(MOVE_TICKS);
      const moved = await api.snapshot();
      shipTravel = hyp(
        moved.ship.x - start.ship.x,
        moved.ship.y - start.ship.y,
      );
      saucerTravel = moved.saucer
        ? hyp(moved.saucer.x - start.saucer.x, moved.saucer.y - start.saucer.y)
        : 0;

      // ...and do collisions still resolve? Put a round just ahead of the saucer, on the side
      // it is travelling toward, so the two close however the build steers it.
      if (moved.saucer) {
        const k = Math.sign(moved.saucer.vx) || -1;
        await api.call("addBullet", {
          x: moved.saucer.x + k * STANDOFF,
          y: moved.saucer.y,
          vx: -k * ROUND_SPEED,
          vy: 0,
        });
      }
      await api.advance(SHOT_TICKS);
      const after = await api.snapshot();
      killed = Boolean(moved.saucer) && !after.saucer;
      stillBanner = after.waveBanner;

      await api.advance(DWELL); // film the banner running out and the wave arriving
    },

    async assert(api, check) {
      check.expectOk(
        "the banner was still up for the whole measurement, so this is the banner being " +
          "graded and not ordinary play",
        stillBanner,
      );
      check.expectGt(
        "the ship keeps flying through the banner",
        shipTravel,
        MIN_TRAVEL,
      );
      check.expectGt(
        "a saucer already on the field keeps moving through the banner",
        saucerTravel,
        MIN_TRAVEL,
      );
      check.expectOk(
        "and it can still be shot down during the banner — collisions are live",
        killed,
      );
    },
  };
}
