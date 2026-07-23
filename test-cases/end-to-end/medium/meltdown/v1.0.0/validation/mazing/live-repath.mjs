// Automated validation for the Mazing sub-item `live-repath`.
//
// Placing a tower re-paths every unit already on the floor live — a walking unit
// continues from where it is on the new route, with no teleporting (specs/playfield.md).
// We let a real Mote walk into mid-field, drop a wall directly ahead of it, and
// confirm it does not jump: its position after the next advance is within one step's
// travel of where it was, and it is still on the floor.

import { newGame, spawn, build, unit } from "../_helpers.mjs";

export default function item() {
  let moteId;
  let walked;
  let m0;
  let m1;
  let routed;

  return {
    id: "mazing.live-repath",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      moteId = await spawn(api, "mote", "left");
    },

    // Walk the Mote into mid-field (720 ticks = the old 12s cap, polled every 6 ticks
    // — the old 0.1s chunk), then drop a wall directly ahead of it and advance 12
    // ticks (the old 0.2s). The short advance is the point: it bounds how far the
    // Mote could legitimately have travelled, so a teleport would stand out.
    async act(api) {
      walked = await api.until(
        (s) => s.surge.some((u) => u.id === moteId && u.x > 300),
        { max: 720, poll: 6 },
      );
      m0 = await unit(api, moteId);

      // Drop a wall directly ahead of the Mote, forcing a live reroute.
      await build(api, "arc", m0.col + 2, m0.row);
      await api.advance(12);
      m1 = await unit(api, moteId);

      routed = isFinite((await api.snapshot()).paths.left.length);
    },

    async assert(api, check) {
      check.expectOk(
        "the Mote walked into mid-field",
        walked.hit && m0 !== null,
      );
      check.expectOk(
        "the Mote is still on the floor after the wall dropped",
        m1 !== null,
      );
      // A Mote travels ~60 px/s, so 0.2 s is ~12 px — a teleport would be far larger.
      check.expectLt(
        "the Mote did not teleport when the route changed",
        Math.hypot(m1.x - m0.x, m1.y - m0.y),
        25,
      );
      check.expectOk("the floor still has an open route", routed);
    },
  };
}
