// injector/aim-rotate-right — holding the turn-right action swings the aim
// clockwise at 180 degrees per second.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("Aiming"): "A held turn
// action then turns the aim by 180 degrees for every second of simulation time
// the update advances, counter-clockwise on screen for turn left and clockwise
// for turn right." specs/overview.md ("The field") fixes the screen convention —
// "`0` along `+x`, increasing toward `+y`", so "an angle therefore turns
// clockwise on screen as it increases" — which makes clockwise the INCREASING
// direction. specs/instrumentation.md fixes the tick at `1 / 60` s, so a 30-tick
// window is exactly half a second and the turn it must cover is exactly
// `180 / 2 = 90` degrees, upward. specs/controls.md ("Actions") reads `aim-right`
// as a held value, and `src/constants.ts` binds it to `ArrowRight`.
//
// This is the mirror of `injector/aim-rotate-left` and is a point of its own
// because the two are independent paths into one angle: a build that turns the
// wrong way under one of them must score differently from one that turns the
// wrong way under both.
//
// THE HALL. `setAim(180)` leaves the aim at a known 180 degrees, and nothing
// else: `specs/instrumentation.md` — "Sets the aim to `angleDegrees`, normalized
// into `[0, 360)`, and does nothing else: no core is released". 180 keeps the
// whole sweep clear of the `[0, 360)` seam. No projectile is fired and nothing
// stands on the channel: `poseHall` holds the inlet (`setEmission`), which is
// independent of the quota, and the quota it leaves is a level start's — so
// `specs/progression.md`'s clear, "the moment its quota is exhausted and no cores
// remain on the channel", never fires, and the turn actions stay live on
// `playing` (specs/controls.md) over an empty hall. The aim is the only thing in
// this scenario.
//
// WHAT IS READ, AND WHY IT IS A DELTA. The item's own drive reads the aim's
// absolute value at the end of a 30-tick hold. This reads its CHANGE across 30
// ticks strictly inside a longer hold instead, because the specification fixes
// the RATE of the turn and says nothing about which tick a fresh key press first
// counts on: a build that samples its keyboard at the top of a tick and one that
// latches it at the end differ by one tick, and one tick of this turn is 3
// degrees — more than the tolerance the rate itself needs. Two lead ticks put
// both readings inside the hold, where that ambiguity has cancelled, so what is
// left is the rate and the direction alone. Both are decided by one signed
// reading: a build that turns the right way at the wrong rate and a build that
// turns the wrong way both miss `+90`.
//
// TOLERANCE. +/- 2 degrees, the figure the review item states. Across a window
// with no edge in it the arithmetic is exact — 30 ticks of `AIM_RATE * TICK_DT`
// is 90.000 degrees however the build accumulates it — so 2 degrees is 1.1% of
// the stated rate, inside the case's standing +/- 2% for a speed measured over at
// least 30 ticks (which here would be 3.6 degrees) and still under one tick's own
// 3-degree step, so a build off by a whole tick's worth of rate cannot pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { AIM_RATE, TICK_DT, TURN_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  poseHall,
  signedTurn,
  type Harness,
} from "../harness";

/** The bearing the pose leaves the aim at, clear of the `[0, 360)` seam. */
const OPENING = 180;

/** Ticks of the hold before the window opens, so no reading sits on an edge. */
const LEAD_TICKS = 2;

/** The measured window: half a second, the case's minimum for a rate reading. */
const WINDOW_TICKS = 30;

/** Ticks of the hold after the window closes, for the replay's context. */
const TRAIL_TICKS = 6;

/** What 30 ticks of `AIM_RATE` cover, clockwise: a signed +90 degrees. */
const EXPECTED_TURN = AIM_RATE * TICK_DT * WINDOW_TICKS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the aim clockwise at 180 degrees per second while ArrowRight is held", async () => {
  await poseHall(h, {});
  h.debug.setAim(OPENING);

  const swung = await captureReplay(h, "right", async () => {
    h.hold("ArrowRight");
    const opened = await h.step(LEAD_TICKS);
    const closed = await h.step(WINDOW_TICKS);
    await h.step(TRAIL_TICKS);
    h.release("ArrowRight");
    return { opened, closed };
  });

  assertEqual(
    swung.closed.screen,
    "playing",
    "the screen the turn was driven on",
  );
  assertNear(
    signedTurn(swung.opened.injector.aim, swung.closed.injector.aim),
    EXPECTED_TURN,
    TURN_TOL,
    `the aim's turn over ${WINDOW_TICKS} ticks of ArrowRight, in degrees`,
  );
});
