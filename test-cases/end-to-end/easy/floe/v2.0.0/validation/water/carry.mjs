// Automated validation for the Water band item `carry`.
//
// A floe carries the critter sideways at the lane velocity while it stands on it,
// and it survives there. A stationary-kind floe is set drifting under the critter's
// tile, and the real drift moves the critter with it, which the snapshot reads
// back. See validation/_helpers.mjs.
//
// NOTHING HERE MAY DEREFERENCE THE CRITTER BLIND. The item's whole premise is that
// the critter is still standing on the floe at the end of the ride, so the failure
// this item exists to catch — a build that does not carry it, and drowns it — is
// exactly the case where it may not be there to read. specs/gameplay.md says that
// while a death is being served "the critter is out of play: it is not on the board",
// and the snapshot contract (specs/instrumentation.md) never says what `critter`
// reports in that state, so a build is free to report no critter at all. Reading
// `after.critter.x` straight through therefore throws against such a build, and a
// throw out of a script is recorded as "the build did not expose the debug API this
// check drives" — a conformance failure — when what actually happened is that the
// carry rule was broken. The item would then blame the wrong thing, in a way a
// reviewer cannot see past. So the ride is read as: was a life spent, is the critter
// still on the board, and only then how far it travelled.

import { startCrossing, TICK_HZ, TILE } from "../_helpers.mjs";

// The measured span. `advance` counts TICKS, but a lane's `speed` is in tiles per
// SECOND, so the expected displacement needs the same span in seconds: 60 ticks at
// 120 Hz is exactly 0.5 s, so both forms are exact and the comparison stays tight.
const DT_TICKS = 60;
const DT = DT_TICKS / TICK_HZ; // 0.5 s

// Camera time after the measurement, so the clip is a ride rather than a glimpse.
// The reading is already taken when this runs, and the critter is riding a lone floe
// on an otherwise cleared-of-nothing row, so the tail only shows more of the same
// drift. 0.5 s of a floe crossing the strait is not enough to read as motion.
const TAIL_TICKS = 120; // 1 s

// The lane the ride is posed on, and the velocity posed onto it.
const LANE_ROW = 5;
const LANE_COL = 20;
const LANE_SPEED = 3; // tiles/second, rightward

export default function item() {
  // The starting x and lives, both read instantly in `arrange` before the drift, and
  // the state at the end of the measured span (which is where the footing is read).
  let bx;
  let livesBefore;
  let after;

  return {
    id: "water.carry",

    // Pose the ride: one floe under the critter's column, drifting right at a known
    // lane speed, with the critter standing on it.
    //
    // The footing is NOT read here. It is a stepped reading (see `actFooting`), and
    // taken off the placement it fails a build that derives footing in the tick that
    // follows — over a snapshot field, while the carry this item scores runs correctly
    // beside it. It is read at the END of the ride instead, off the same snapshot the
    // displacement is measured from, where it says something stronger anyway: the
    // critter was still standing on the floe when the measured span ended.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLane", LANE_ROW, {
        cols: [LANE_COL],
        speed: LANE_SPEED,
        dir: 1,
      }); // floe under col 20 drifting right
      await api.call("placeCritter", LANE_COL, LANE_ROW);
      const s = await api.snapshot();
      bx = s.critter.x;
      livesBefore = s.lives;
    },

    // The validate pass advances the sim by exactly this much (no stray wall-clock
    // frames), so the carry equals the lane velocity times dt to within float
    // rounding. The critter riding the drifting floe is also the clip.
    async act(api) {
      await api.advance(DT_TICKS);
      after = await api.snapshot();
      await api.advance(TAIL_TICKS); // camera only: more of the ride
    },

    async assert(api, check) {
      // Survival first, and led by the life. specs/instrumentation.md does require an
      // observable `dying` for every death, so the phase test below is legitimate — but
      // it is the narrower of the two facts, because it only holds while the pause is
      // still running and this sample lands wherever the measured span ended. The life
      // count is what specs/gameplay.md makes a death MEAN, it does not expire, and it
      // is the one reading that cannot be true of a critter that rode the floe safely.
      check.expectEq("riding the floe costs no life", after.lives, livesBefore);
      check.expectNe("the critter survives on the floe", after.phase, "dying");
      check.expectEq("still crossing", after.screen, "playing");

      // Only now the measurement. A build that lost the critter records `null` here and
      // fails on the number, beside the life it spent — which reads as the carry rule
      // being broken, which is what happened.
      const carried = after.critter ? after.critter.x - bx : null;
      check.expectOk(
        "the critter is still on the board at the end of the ride",
        after.critter != null,
      );
      check.expectEq(
        "footing at the end of the ride still reads 'floe'",
        after.critter ? after.critter.footing : null,
        "floe",
      );
      check.expectClose(
        "the floe carries the critter by the lane velocity",
        carried,
        LANE_SPEED * TILE * DT,
        1e-3,
      );
    },
  };
}
