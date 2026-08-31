// controls/edge-once-per-press — an edge action fires once per press.
//
// specs/controls.md reads every non-rotation action "as a press edge, true
// once for the frame in which the held value became true", and adds: "a key
// event whose `repeat` flag is set arms no edge". So holding `Space` over
// many ticks launches the parked ball once and no more, and the auto-repeat
// `keydown`s a held key streams arm nothing further.
//
// THE PROBE IS A SECOND PARKED BALL UNDER THE STILL-HELD KEY. A launch on an
// unparked field changes nothing, so a re-fired edge would be invisible on an
// empty deflector; instead, after the press has launched the first ball, a
// fresh ball is parked through the surface while the key is STILL down and
// the ticks that follow are watched. A build reading `launch` as a held value
// launches the new ball at once; a conformant build leaves it parked until
// the next distinct press.
//
// THE REPEAT PROBE IS A GENUINE REPEAT. Pressing a key Chromium already holds
// down dispatches a `keydown` whose `repeat` flag is set — exactly the event
// the spec sentence names — so the second `keyDown` below is the OS
// auto-repeat, through the browser's own input pipeline, and the reparked
// ball must still be parked after it.

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

afterEach(async () => {
  await h?.dispose();
});

it("launches once for a press however long the key is held", async () => {
  await isolate(h);
  await h.debug.parkBall();
  const parked = await h.snapshot();
  assertLength(parked.balls, 1, "balls after parking one");
  assertTrue(parked.balls[0].parked, "the posed ball is parked");

  const after = await captureReplay(h, "once", async () => {
    await h.keyDown(KEY);
    try {
      await h.settleFrame();
      const launched = await h.tick(5);
      assertLength(launched.balls, 1, "balls after the press lands");
      assertEqual(
        launched.balls[0].parked,
        false,
        "the press launched the parked ball",
      );

      await h.debug.parkBall();
      const heldOver = await h.tick(10);
      assertLength(
        heldOver.balls.filter((ball) => ball.parked),
        1,
        "the reparked ball still parked under the still-held key",
      );

      // The OS auto-repeat of the held key: a keydown with `repeat` set.
      await h.keyDown(KEY);
      await h.settleFrame();
      return await h.tick(5);
    } finally {
      await h.keyUp(KEY);
    }
  });

  assertLength(after.balls, 2, "balls at the end of the hold");
  assertLength(
    after.balls.filter((ball) => ball.parked),
    1,
    "the reparked ball still parked — neither the held key nor its repeat armed a launch",
  );
});
