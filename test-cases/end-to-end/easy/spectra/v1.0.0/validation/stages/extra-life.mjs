// Automated validation for the Stages sub-item `extra-life`.
//
// Crossing 20000 points awards one extra life, once; a later crossing awards no
// further life. The score is posed just below 20000 and a REAL matching kill crosses
// it (the award happens in the real scoring path, not fabricated); a later kill,
// already past the threshold, adds no life. A spare drone is kept alive so clearing
// a target does not end the wave.

// The item's output is a CLIP rather than a still. A single frame of a HUD reading
// four lives says nothing on its own: the point is the crossing — three lives and a
// score just short of 20000, a kill that takes it over, and a fourth life appearing.
// So `act` opens on the pre-state, lets each kill fly up from the ship's lane, and
// holds between them, and the reviewer watches the award happen and then watches
// the second crossing NOT award anything.

import {
  startClean,
  holdDrones,
  spawnDrone,
  spawnBystander,
  shootFromLane,
  findDrone,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

// Room for a shot to fly up from the ship's lane to the drone.
const KILL_MAX_TICKS = 180;

// A beat on the pre-state (3 lives, 19950) before the crossing kill, and another on
// the awarded fourth life before the second kill, so the clip reads as three
// distinct moments rather than one flicker.
const BEAT_TICKS = 96;

export default function item() {
  // The first target, and the state after each of the two kills.
  let firstId;
  let a;
  let b;

  return {
    id: "stages.extra-life",

    // The score is posed just under the threshold so a single real kill crosses it
    // through the real scoring path. A keepalive drone sits far from the target lane
    // and is never shot, so destroying a target never empties the field (which would
    // end the wave and cut the second half of the check short).
    // The swarm is held (`holdDrones`), so both targets stand in the ship's column
    // for the lane shots and the keepalive cannot peel into a dive and reach the
    // ship — a life lost mid-scenario would read as the second crossing having
    // awarded nothing when in fact it had.
    async arrange(api) {
      await startClean(api);
      await holdDrones(api);
      await api.call("setLives", 3);
      await api.call("setScore", 19950); // a formation Shard kill (+50) crosses 20000
      await spawnBystander(api); // keepalive, far off the target lane
      firstId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
    },

    async act(api) {
      // The pre-state: three lives, the score just short of the threshold.
      await api.advance(LEAD_IN_TICKS);

      // The crossing kill, flown up from the lane so the reviewer watches the score
      // tick over 20000 and the fourth life appear.
      await shootFromLane(api, firstId, "cyan");
      a = await api.until((s) => findDrone(s, firstId) === null, {
        max: KILL_MAX_TICKS,
      });

      // Hold on the awarded life, so the HUD's step from three to four is legible
      // before anything else happens.
      await api.advance(BEAT_TICKS);

      // A later crossing (already past 20000) awards no further life. The second
      // target is posed with `spawnDrone` — a control op, so no reset is needed and
      // the clock is never taken back.
      const secondId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
      await shootFromLane(api, secondId, "cyan");
      b = await api.until((s) => findDrone(s, secondId) === null, {
        max: KILL_MAX_TICKS,
      });

      // …and hold on the UNCHANGED life count, which is the whole of the second
      // half of this item: the score climbs again and nothing is awarded.
      await api.advance(BEAT_TICKS);
    },

    async assert(api, check) {
      check.expectGe("the score crossed 20000", a.snap.score, 20000);
      check.expectEq("crossing 20000 awards one extra life", a.snap.lives, 4);
      check.expectEq(
        "a later crossing awards no further life",
        b.snap.lives,
        4,
      );
    },
  };
}
