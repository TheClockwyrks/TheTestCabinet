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
// THE SAUCER'S OWN CRUISE IS MEASURED, NOT IMPOSED. This item used to pose `vx` and then
// assert the saucer still reported that exact number, which conflates two different
// questions: whether the star pulled the saucer, and whether `setSaucer` honoured a
// velocity. The second is real — the spec says `setSaucer` may set `vx` — but it belongs to
// `wrap/saucer`, which needs the saucer aimed at a particular edge and says so in as many
// words. Here it only got in the way: a build that steers its saucer from the edge it
// entered by, and so overwrote the posed `vx` on the next step, failed this item reporting
// "the saucer gains no speed toward the star: expected 140, actual -140" — a saucer that
// was in fact flying a dead-straight line at a constant speed, exactly as the item exists
// to confirm. So the drive asks for a heading, steps ONE tick to let the build's own
// steering have its say, and then reads whatever cruise the saucer actually flies at. The
// side it starts from is chosen from that reading, so it is always closing on the star, and
// the control rock is mirrored against the same number. What is asserted is that the cruise
// is UNCHANGED after crossing — which is what "the star does not pull it" means, on any
// build, however it chose to point its saucer.
//
// Posing the two bodies is the precondition (`arrange`); the crossing is the behavior
// (`act`), so the clip shows the saucer holding a dead-straight, constant-speed line while
// the rock opposite it visibly accelerates into the star. 1 s x 120 Hz = 120 ticks.

import { newGame, STAR_X, STAR_Y, SAUCER_CRUISE, ticks } from "../_helpers.mjs";

// Both bodies start this far out, on opposite sides of the star, and cruise inward — far
// enough that neither reaches the saucer's avoidance radius or the core within the window.
const OFFSET = 440;
const SPAN = 1; // seconds of crossing

export default function item() {
  // The cruise the saucer actually flies at, where it started, and the two bodies after
  // crossing — all read by `assert`.
  let cruise;
  let startX;
  let s;
  let r;

  return {
    id: "gravity.saucer-free",

    async arrange(api) {
      await newGame(api);
      await api.call("spawnSaucer");
      // Ask for a heading, then give the build one step to answer with whatever its
      // saucer actually flies. `skip` rather than `advance`: it is instant in BOTH
      // passes, so this stays a precondition and never becomes part of the clip.
      await api.call("setSaucer", { y: STAR_Y, vx: SAUCER_CRUISE, vy: 0 });
      await api.skip(1);
      cruise = (await api.snapshot()).saucer?.vx ?? 0;

      // Put the saucer on whichever side means it is closing on the star, and mirror the
      // control rock on the other side closing at the same speed.
      const k = Math.sign(cruise) || 1;
      startX = STAR_X - k * OFFSET;
      await api.call("setSaucer", { x: startX, y: STAR_Y, vy: 0 });
      await api.call("addRock", "large", {
        x: STAR_X + k * OFFSET,
        y: STAR_Y,
        vx: -cruise,
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

      // The scenario only means anything if the saucer is actually crossing. A saucer
      // sitting still would hold its velocity perfectly and prove nothing, so the cruise
      // it is measured against has to be a real one first.
      check.expectGt(
        "the saucer is under way at a real crossing speed",
        Math.abs(cruise),
        80,
      );

      // How far each body would still be from the star if nothing but its own motion
      // carried it. The control must beat this; the saucer must land on it exactly.
      const drift = OFFSET - Math.abs(cruise) * SPAN;

      // The control. A rock on this line is pulled straight along its own heading, so it
      // both speeds up and overshoots where momentum alone would have carried it. This is
      // what "bent toward the star" looks like, and it calibrates the checks below.
      check.expectGt(
        "the star speeds the control rock up",
        Math.abs(r.vx),
        Math.abs(cruise) + 5,
      );
      check.expectLt(
        "the star draws the control rock in past its own drift",
        Math.abs(r.x - STAR_X),
        drift - 2,
      );

      // The saucer, same row and same distance: no pull at all. Anything the star did to
      // it would show up on this axis, which the saucer's own steering never writes.
      check.expectClose(
        "the star does not change the saucer's cruising speed",
        s.vx,
        cruise,
        0.5,
      );
      check.expectClose(
        "the saucer travels exactly the distance its own cruise carries it",
        Math.abs(s.x - STAR_X),
        drift,
        1,
      );
    },
  };
}
