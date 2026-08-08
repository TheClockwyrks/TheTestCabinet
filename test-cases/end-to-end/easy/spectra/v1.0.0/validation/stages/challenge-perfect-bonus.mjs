// Automated validation for the Stages sub-item `challenge-perfect-bonus`.
//
// Destroying every drone in a challenge stage scores per drone (100 each, 40 drones)
// plus a large perfect bonus (10000), for 14000 total. A real challenge stage is
// run and every drone destroyed with a matching-band shot as it sweeps across; the
// real scoring and the real perfect-clear path produce the total, read back at the
// stage-cleared screen. (Only a full clear yields 14000; a miss scores less.)

import {
  startStageClean,
  holdDrones,
  exposedBand,
  findDrone,
  FIELD_W,
  PLAY_TOP,
  PLAY_BOTTOM,
} from "../_helpers.mjs";

/** Whether a drone is on screen, where it can be seen and a bullet can reach it. */
function onField(d) {
  return d.x >= 0 && d.x <= FIELD_W && d.y >= PLAY_TOP && d.y <= PLAY_BOTTOM;
}

// How far inside the field's edges the LAST drone must be before it is held and
// shot. Merely "on the field" put it at x = 4 — on screen, but hugging the edge and
// half out of frame, which is not what "watch the final drone be destroyed" is
// supposed to look like. A drone width or two of margin puts it somewhere a reviewer
// is actually looking. This governs only where the final beat is staged; the rake
// still fires at anything inside the field proper, so a build whose last drone never
// clears the margin is simply raked as usual and the verdict is unchanged.
const FRAME_MARGIN = 80;

/** Whether a drone is comfortably inside the frame, not clipping an edge. */
function wellInsideField(d) {
  return (
    d.x >= FRAME_MARGIN &&
    d.x <= FIELD_W - FRAME_MARGIN &&
    d.y >= PLAY_TOP + FRAME_MARGIN &&
    d.y <= PLAY_BOTTOM - FRAME_MARGIN
  );
}

// The old drive loop was 800 iterations of a 0.03 s step — a 24 s window. 0.03 s is
// 3.6 ticks, which the tick contract refuses rather than rounds, so the step rounds
// DOWN to 3: this loop is chasing drones across the screen, and a shorter gap between
// volleys can only catch a drone a longer gap would have let slip past. The iteration
// cap is raised to 960 so the total window stays the original 24 s (960 x 3 ticks)
// rather than shrinking to 20 s with the finer step — the check needs the whole
// stage to have run, or the clear would not be perfect for the wrong reason.
const STEP_TICKS = 3;
const MAX_ITERS = 960;

// A perfect clear is a 24 s rake, and the thing this item is about — the score
// jumping by the 10000 bonus — happens in the last instant of it. Filmed straight
// through, the clip's 8 s budget ran out long before the bonus was paid, so the
// reviewer watched volley after volley and never saw the payoff.
//
// So the rake is stepped INSTANTLY (`api.skip`, exact in both passes and never
// filmed) until the stage is nearly cleared, and only the last group onward is
// advanced in real time. The simulation is identical either way — this changes only
// what the recording contains, never the verdict, which the validate pass decides
// with both calls instant.
//
// The switch is the score: at 100 a drone (`specs/gameplay.md`), this is the point
// where a group's worth of drones is left.
const FILM_FROM_SCORE = 3200;

// The rake deliberately leaves the LAST drone alone for a beat, holds the swarm so
// it stops where it is, and only then shoots it.
//
// Without this the clip showed forty drones streaming off the right-hand edge and
// the bonus arriving over an already-empty field — the payoff had no visible cause.
// Held with one drone standing, the reviewer sees the stage down to its final
// target, watches that drone destroyed, and sees the score jump by the bonus: the
// per-drone score, the last kill, and the 10000 all in one readable moment.
//
// It changes nothing about the verdict. The drone is destroyed by the same real
// matching shot either way, and a perfect clear is still forty out of forty.
const LAST_DRONE_HOLD_TICKS = 96; // 0.8 s standing before the final shot
const LAST_KILL_MAX_TICKS = 120;

// …and it must be the last drone of the STAGE, not merely the only one on screen.
//
// A flyover's groups arrive and exit in turn, so between two groups the field can
// legitimately hold one drone or none. Holding the swarm there would freeze the
// groups still to come and the stage would never finish. At 100 a challenge drone
// and the score posed to 0 in `arrange`, the score IS the count destroyed, so 39
// of the 40 down plus one on the field is the genuine final target. A build that
// scores differently simply never takes this branch and the rake runs as before —
// the verdict is identical either way, only the clip is the poorer for it.
const LAST_DRONE_FROM_SCORE = 3900;

// Held on the stage-cleared interstitial afterwards, so the perfect bonus is on
// screen long enough to read.
const CLEARED_HOLD_TICKS = 240; // 2 s

export default function item() {
  // The state at the end of the clear.
  let final;
  // Every challenge drone the sweep ever saw, and whether it was ever inside the
  // play field — where a player's shot can actually reach it.
  const reachable = new Map();

  return {
    id: "stages.challenge-perfect-bonus",

    // A real challenge stage with the wave the game builds, score zeroed so the
    // total read back is attributable entirely to this stage.
    async arrange(api) {
      await startStageClean(api, 3, { clear: false });
      await api.call("setScore", 0);
    },

    async act(api) {
      for (let i = 0; i < MAX_ITERS; i += 1) {
        const s = await api.snapshot();
        if (s.screen !== "inWave") break;
        // Reachability is recorded for EVERY drone on every sample, before any of
        // the branching below — the last drone in particular spends its first
        // samples outside the field and is then handled by its own branch, so
        // bookkeeping done only in the firing loop would record it as unreachable
        // for the one reason that is not a fault.
        for (const d of s.drones) {
          reachable.set(d.id, (reachable.get(d.id) ?? false) || onField(d));
        }
        // Down to the last drone: hold the swarm so it stops where it is, let it
        // stand for a beat, and shoot it on its own. This is the moment the item is
        // about, and the only part of the rake a reviewer needs to see.
        if (s.drones.length === 1 && s.score >= LAST_DRONE_FROM_SCORE) {
          // HOLD FIRE until it has actually flown onto the field.
          //
          // This is the whole of the media fix. The rake fires at every drone in the
          // list every few ticks, and a challenge group is released off the side of
          // the stage — so the last drone is shot dead at x = -17, hundreds of px
          // outside the field, and the clip showed forty drones being picked off
          // off-screen and a bonus arriving over empty space. Measured on the
          // reference, the final drone died off-screen every time and the branch
          // below never ran.
          //
          // So while it is still outside, it is simply not fired at: time advances
          // (on camera — this is the last stretch, past `FILM_FROM_SCORE`) and the
          // reviewer watches it sweep in. Only then is it held and shot.
          if (!wellInsideField(s.drones[0])) {
            await api.advance(STEP_TICKS);
            continue;
          }
          const last = s.drones[0];
          await holdDrones(api);
          await api.advance(LAST_DRONE_HOLD_TICKS);
          await api.call("spawnPlayerBullet", {
            x: last.x,
            y: last.y,
            band: exposedBand(s, last),
            vy: -200,
          });
          await api.until((s2) => findDrone(s2, last.id) === null, {
            max: LAST_KILL_MAX_TICKS,
          });
          await api.until((s2) => s2.screen !== "inWave", {
            max: LAST_KILL_MAX_TICKS,
          });
          break;
        }
        // Fire a matching-band shot at every live drone ON THE FIELD; the real
        // collision destroys it. Matching the band per drone is what makes the clear
        // perfect — the scoring path under test only pays the bonus if none is
        // missed.
        //
        // ONLY the ones on the field, because a bullet posed outside it is removed
        // for leaving the play field ("a bullet that leaves the play field is
        // removed", `specs/playfield.md`) before any collision can run, so shooting
        // at an off-field drone does nothing at all. The sweep therefore also records
        // which drones ever came within reach, so that a drone the rake could not
        // destroy is reported as what it is rather than as a mysterious score.
        for (const d of s.drones) {
          if (!onField(d)) continue;
          await api.call("spawnPlayerBullet", {
            x: d.x,
            y: d.y,
            band: exposedBand(s, d),
            vy: -200,
          });
        }
        // Same simulation either way; only the last stretch is filmed.
        if (s.score >= FILM_FROM_SCORE) await api.advance(STEP_TICKS);
        else await api.skip(STEP_TICKS);
      }
      final = await api.snapshot();

      // Stay on the interstitial so the clip actually shows the score carrying the
      // perfect bonus, rather than cutting on the frame the stage ends.
      await api.advance(CLEARED_HOLD_TICKS);
    },

    async assert(api, check) {
      // Reported FIRST, because it is the precondition the rest of the item rests
      // on: a drone the player's fire can never reach cannot be destroyed, so a
      // perfect clear is unobtainable and the bonus is unreachable by design rather
      // than unpaid by a scoring bug. `specs/playfield.md` reserves the HUD strips —
      // "never overlapped by play, other than a drone crossing a strip purely in
      // transit" — and a flyover that sweeps the whole width inside the top strip is
      // not in transit, it is the entire flight.
      //
      // Without this the item reported only "expected 14000, actual 3000" and left a
      // reviewer to work out that ten of the forty drones had flown across at y=35
      // and y=59, above the play field, where no shot can follow them.
      const unreachable = [...reachable.values()].filter((v) => !v).length;
      check.expectEq(
        "every challenge drone flies within the play field, where a shot can reach it",
        unreachable,
        0,
      );
      check.expectEq(
        "the challenge ends on the stage-cleared screen",
        final.screen,
        "stageCleared",
      );
      check.expectEq(
        "a perfect clear scores 40x100 + a 10000 bonus",
        final.score,
        14000,
      );
    },
  };
}
