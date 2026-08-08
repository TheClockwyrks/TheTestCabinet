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

    // The approach is skipped, so this covers the beat before the wall, the drop, and
    // the two seconds of re-routing after it.
    clipMs: 6000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      moteId = await spawn(api, "mote", "left");
      // Walk it into mid-field through the real simulation, unfilmed. 720 ticks is a
      // 12 s ceiling, polled every 6.
      walked = await api.skipUntil(
        (s) => s.surge.some((u) => u.id === moteId && u.x > 300),
        { max: 720, poll: 6 },
      );
    },

    // Drop a wall directly ahead of the walking Mote and watch it bend around it.
    //
    // THE WALK IS SKIPPED AND THE RE-PATH IS FILMED, which is the other way round from
    // how this used to run. The old drive spent up to twelve seconds of clip watching a
    // Mote cross open floor to reach mid-field, dropped the wall, ran on for a fifth of a
    // second and stopped — so the approach was most of the recording and the behaviour
    // was two frames at the end of it. A reviewer could see that the Mote had not
    // teleported and could not see it route around anything. The walk now happens in
    // `arrange` through `skipUntil` (the same real simulation, just not recorded), so the
    // clip opens with the Mote already mid-field.
    //
    // The 12-tick advance after the wall drops is unchanged and still decides the
    // verdict: it bounds how far the Mote could legitimately have travelled, so a
    // teleport would stand out. The beat after it is what shows the new route being
    // walked.
    async act(api) {
      // A moment on the open floor first, so the route the wall is about to break is
      // visible before it breaks.
      await api.advance(45);

      // Read the Mote's position HERE, immediately before the wall drops — the
      // no-teleport bound below is `m1` against `m0` over one short advance, so any
      // travel between the two readings has to be travel the bound allows for.
      m0 = await unit(api, moteId);

      // Drop a wall directly ahead of the Mote, forcing a live reroute.
      await build(api, "arc", m0.col + 2, m0.row);
      await api.advance(12);
      m1 = await unit(api, moteId);

      routed = isFinite((await api.snapshot()).paths.left.length);

      // And the re-path itself: two seconds of the Mote steering round the new wall
      // from where it stood, which is the whole of what "re-paths live" looks like.
      await api.advance(120);
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
