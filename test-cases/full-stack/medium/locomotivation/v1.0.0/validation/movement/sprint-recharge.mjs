// Movement: sprinting drains the sprint bar; when not sprinting it refills over about
// four seconds from empty to full. Driven unladen on the manual clock so drain and
// refill are exact.

import { setTile, startFresh, SPRINT_MAX } from "../_helpers.mjs";

export default function item() {
  // The charge at the start, after the drain, and after the refill.
  let started;
  let drained;
  let refilled;

  return {
    id: "movement.sprint-recharge",

    // Pose the worker unladen (sprint unlocked, bar full) with room to run right, and
    // read the starting charge — a pure snapshot read, so it costs no time.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 4, 12);
      started = (await api.snapshot()).worker.sprintCharge;
    },

    // Drain then refill, back to back. That whole arc is the behavior under test and is
    // also what the clip shows: the worker sprinting off, then walking while the bar
    // fills back up.
    async act(api) {
      // Sprint for one second: the bar drains one second's worth. 60 ticks = the old 1.0s.
      await api.call("keyDown", "KeyD");
      await api.call("keyDown", "ShiftLeft");
      await api.advance(60);
      drained = (await api.snapshot()).worker.sprintCharge;

      // Stop sprinting and let it refill; ~4 s empty→full, so from ~0.6 a few seconds
      // refills to the cap. 270 ticks = the old 4.5s.
      await api.call("keyUp", "ShiftLeft");
      await api.call("keyUp", "KeyD");
      await api.advance(270);
      refilled = (await api.snapshot()).worker.sprintCharge;
    },

    async assert(api, check) {
      check.expectClose("sprint starts full", started, SPRINT_MAX, 1e-6);
      check.expectClose(
        "one second of sprint drains one second of charge",
        drained,
        SPRINT_MAX - 1.0,
        0.03,
      );
      check.expectClose(
        "the bar recharges back to full",
        refilled,
        SPRINT_MAX,
        1e-3,
      );
      check.expectGt(
        "the refilled bar is fuller than after the drain",
        refilled,
        drained,
      );
    },
  };
}
