// controls/edge-once-per-press — an edge action fires once per press.
//
// specs/controls.md reads every non-rotation action as a press edge — the
// engine delivers "every other action as one press edge per press" — so
// holding `Space` over many ticks launches the parked ball once and no more.
//
// THE PROBE IS A SECOND PARKED BALL UNDER THE STILL-HELD KEY. A launch on an
// unparked field changes nothing, so a re-fired edge would be invisible on an
// empty deflector; instead, after the press has launched the first ball, a
// fresh ball is parked through the surface while the key is STILL down and
// the ticks that follow are watched. A build reading `launch` as a held value
// launches the new ball at once; a conformant build leaves it parked until
// the next distinct press.
//
// The other half of the rule — that an OS auto-repeat `keydown` (`repeat`
// set) arms no edge — lives in the engine's own input layer under this mode,
// which is not reachable as a distinct event through a player's keyboard
// here; the held-key probe above is the half the build owns.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { BINDINGS } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";

/** The edge action pressed, as `specs/controls.md` binds `launch`. */
const KEY = BINDINGS.launch[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("launches once for a press however long the key is held", async () => {
  isolate(h);
  h.debug.parkBall();
  const parked = h.snapshot();
  assertLength(parked.balls, 1, "balls after parking one");
  assertTrue(parked.balls[0].parked, "the posed ball is parked");

  const after = await captureReplay(h, "once", async () => {
    h.holdKey(KEY);
    try {
      const launched = await h.tick(5);
      assertLength(launched.balls, 1, "balls after the press lands");
      assertEqual(
        launched.balls[0].parked,
        false,
        "the press launched the parked ball",
      );
      h.debug.parkBall();
      return await h.tick(10);
    } finally {
      h.releaseKey(KEY);
    }
  });

  assertLength(after.balls, 2, "balls at the end of the hold");
  assertLength(
    after.balls.filter((ball) => ball.parked),
    1,
    "the reparked ball still parked — the held key armed no further launch",
  );
});
