// Automated validation for the Gravity item `saucer-free`: the saucer is a powered craft
// and is never pulled by the star. The saucer and a control rock are posed on the star's
// ROW, on opposite sides at the same distance, each cruising along that row toward it.
//
// The measurement is taken on the HORIZONTAL axis deliberately. On the star's row the pull
// is purely horizontal, while everything the saucer does to itself — the weave
// (`specs/hazards.md`: it changes its vertical direction every second or so) and the
// star-avoidance steer — is purely vertical. Reading `vy` instead would read the weave
// rather than the star, and would fail a conformant saucer for weaving on schedule.
//
// The rock is the control: it proves gravity is live and pulling hard at this exact
// distance, so "the saucer did not move" cannot pass by the star being weak or absent. It
// is mirrored across the star rather than posed alongside the saucer so the two never
// share a spot, and by symmetry it sees the same pull.
//
// Posing the two bodies is the precondition (`arrange`); the crossing is the behavior
// (`act`), so the clip shows the saucer holding a dead-straight, constant-speed line while
// the rock opposite it visibly accelerates into the star. 1 s x 120 Hz = 120 ticks.

import { newGame, STAR_X, STAR_Y, ticks } from "../_helpers.mjs";

// Both bodies start this far out, on opposite sides of the star, and cruise inward at the
// saucer's spec crossing speed — far enough that neither reaches the saucer's avoidance
// radius or the core within the window.
const OFFSET = 440;
const CRUISE = 140; // px/s, the saucer's spec crossing speed (`specs/hazards.md`)
const SPAN = 1; // seconds of crossing

export default function item() {
  // The saucer and the control rock after crossing, read by `assert`.
  let s;
  let r;

  return {
    id: "gravity.saucer-free",

    async arrange(api) {
      await newGame(api);
      await api.call("spawnSaucer");
      await api.call("setSaucer", {
        x: STAR_X - OFFSET,
        y: STAR_Y,
        vx: CRUISE,
        vy: 0,
      });
      await api.call("addRock", "large", {
        x: STAR_X + OFFSET,
        y: STAR_Y,
        vx: -CRUISE,
        vy: 0,
      });
    },

    async act(api) {
      await api.advance(ticks(SPAN));
      const snap = await api.snapshot();
      s = snap.saucer;
      r = snap.rocks[0];
    },

    async assert(api, check) {
      check.expectOk("the saucer is on the field", Boolean(s));
      check.expectOk("the control rock is on the field", Boolean(r));

      // The control. A rock on this line is pulled straight along its own heading, so it
      // both speeds up and overshoots where momentum alone would have carried it. This is
      // what "bent toward the star" looks like, and it calibrates the checks below.
      const rockCruise = STAR_X + OFFSET - CRUISE * SPAN;
      check.expectGt(
        "the star speeds the control rock up",
        Math.abs(r.vx),
        CRUISE + 5,
      );
      check.expectLt(
        "the star draws the control rock in past its own drift",
        r.x,
        rockCruise - 2,
      );

      // The saucer, same row and same distance: no pull at all. Anything the star did to
      // it would show up on this axis, which the saucer's own steering never writes.
      check.expectClose(
        "the saucer gains no speed toward the star",
        s.vx,
        CRUISE,
        0.5,
      );
      check.expectClose(
        "the saucer travels exactly the distance its own cruise carries it",
        s.x,
        STAR_X - OFFSET + CRUISE * SPAN,
        1,
      );
    },
  };
}
