// instrumentation/advances-in-frames — the simulation advances on the elapsed time
// it is handed, and on nothing else.
//
// specs/instrumentation.md "A deterministic core": the game's state "advances from
// the elapsed time the game is handed, independent of a canvas, of the frame loop
// that measured it, and of wall-clock time. The dependency runs one way: the
// simulation reads nothing from the renderer. Every rate is per second and
// integrated against the delta the frame supplies, so an interval of game time
// covered as one frame and as sixty frames advances `simTime` by the same amount
// and carries a flyer the same distance along `x` at a constant `vx`."
//
// ONE SECOND, TWO DIVISIONS. The same second of game time is covered as a single
// 1000 ms frame and as sixty 1000/60 ms frames, over the same posed world, and the
// two must agree on both readings the sentence names: `simTime` gains 1.0 in each,
// and the card in flight is at the same `x` in each.
//
// WHY `x` AND NOT `y`. specs/victory.md's per-frame steps add gravity to `vy` and
// then integrate the new `vy`, which is semi-implicit Euler: a quantity under
// acceleration depends on how the interval was divided, and a build whose `y`
// agreed across the two divisions would be one that had NOT implemented the stated
// integration. `x` is under no acceleration, so `vx` is constant and the distance
// covered is `vx` times the elapsed time however it was divided. The item names `x`
// and `simTime` for exactly that reason, and this check reads no other quantity.
//
// THE CARD IS POSED CLEAR OF THE FLOOR AND OF BOTH SIDE EDGES. `240` units per
// second from `x` `340` carries it to `560` over the second, hundreds of units
// inside both edges, so the retirement rule never enters the reading; and it is
// thrown upward hard enough that the sixty-frame arc never reaches `FLOOR_Y`
// (`580`), so no bounce touches it either. The single 1000 ms frame is a different
// matter: one step of semi-implicit Euler over a whole second lands far below any
// starting height a card can be posed at, so that division does meet the floor. It
// cannot affect what is read, because specs/victory.md's bounce reflects `vy` and
// leaves `vx` untouched, and `x` and `simTime` are the whole of the reading.
//
// LAUNCHING IS GATED OFF and the table is empty, so the one card in flight is the
// one the check posed. The painting is gated off as well: it is no part of this
// point, and a full-screen stamp on every one of the sixty frames would bury the
// card in the still that is meant to show where it ended.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  ConstantClock,
  createHarness,
  flyerOf,
  lastFlyer,
  openTable,
  type Harness,
} from "../harness";

/** The second of game time both runs cover, and the two ways it is divided. */
const SPAN_S = 1;
const ONE_FRAME_MS = SPAN_S * 1000;
const SIXTY_FRAMES = 60;
const SIXTY_FRAME_MS = ONE_FRAME_MS / SIXTY_FRAMES;

/**
 * The card posed in flight, as its top-left and velocity in logical units.
 *
 * The upward throw is what keeps the sixty-frame arc clear of `FLOOR_Y` (`580`):
 * from `y` `200` at `-700` units per second under `GRAVITY` (`1800`) the card rises
 * to about `y` `64` and comes back to about `415`, and it never reaches the floor.
 */
const FLYER = { x: 340, y: 200, vx: 240, vy: -700 };

/**
 * How far apart the two divisions may put the card along `x`, in logical units.
 *
 * Half a unit, which is the figure this point is stated at. `x` is `vx` times the
 * elapsed time in both divisions, so a build that integrates against the delta it
 * was handed lands on the same number in each and the half unit is float noise; a
 * build that moved a fixed step per frame is sixty times out.
 */
const X_TOLERANCE = 0.5;

/**
 * The tolerance on the second `simTime` gained.
 *
 * Six decimal places. Each run is handed exactly `SPAN_S` seconds by its own
 * constant clock, so anything past float noise is a build accumulating something
 * other than the delta it was given.
 */
const EXACT = 6;

let one: Harness;
let sixty: Harness;

beforeEach(async () => {
  one = await createHarness({ clock: new ConstantClock(ONE_FRAME_MS) });
  sixty = await createHarness({ clock: new ConstantClock(SIXTY_FRAME_MS) });
});

afterEach(() => {
  one?.dispose();
  sixty?.dispose();
});

it("gains the same second and covers the same x, however the second is divided", async () => {
  /** Pose the world, cover one second, and answer what the run reached. */
  const cover = async (
    h: Harness,
    frames: number,
    outputId: string,
  ): Promise<{ gained: number; x: number }> => {
    openTable(h);
    h.debug.setScreen("won");
    h.debug.setLaunching(false);
    h.debug.setTrailPainting(false);
    h.debug.clearFlyers();
    h.debug.addFlyer("spades", 13, FLYER.x, FLYER.y, FLYER.vx, FLYER.vy);
    const id = lastFlyer(h.snapshot()).id;

    const opened = h.snapshot();
    await h.advance(frames);
    const closed = h.snapshot();

    // The flyer after the second, as this division drew it.
    captureStill(h, outputId);

    return {
      gained: closed.simTime - opened.simTime,
      x: flyerOf(closed, id).x,
    };
  };

  const asOne = await cover(one, 1, "one-frame");
  const asSixty = await cover(sixty, SIXTY_FRAMES, "sixty-frames");

  assertCloseTo(
    asOne.gained,
    SPAN_S,
    EXACT,
    "the simTime gained by one second of game time covered as a single frame " +
      "(specs/instrumentation.md)",
  );
  assertCloseTo(
    asSixty.gained,
    SPAN_S,
    EXACT,
    "the simTime gained by the same second covered as sixty frames " +
      "(specs/instrumentation.md)",
  );

  assertLessThanOrEqual(
    Math.abs(asSixty.x - asOne.x),
    X_TOLERANCE,
    `how far the two divisions put the card apart along x, one frame at ` +
      `${asOne.x} against sixty at ${asSixty.x}: a constant vx carries a card ` +
      "the same distance however the second was divided " +
      "(specs/instrumentation.md)",
  );
});
