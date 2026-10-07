// controls/repeat-arms-no-edge — a key event whose repeat flag is set arms no
// edge.
//
// specs/controls.md, of the runtime layer's action reads: "A key event whose
// `repeat` flag is set arms no edge." So the auto-repeat `keydown`s a held key
// streams launch nothing further. That ONE held press fires an edge exactly once
// is `edge-once-per-hold`: a build that reads the action as a held value and one
// that honours the hold but re-arms on the repeat are different defects.
//
// THE REPEAT IS A GENUINE ONE. Pressing a key Chromium already holds down
// dispatches a `keydown` whose `repeat` flag is set — exactly the event the spec
// sentence names — so the second `keyDown` below is the OS auto-repeat through
// the browser's own input pipeline, and the reparked ball must still be parked
// after it.
//
// THE WORLD IS THE DEFLECTOR AND ITS SERVE, per isolate(). The first press's own
// launch is arranged and then set aside: a ball is reparked before the repeat,
// so what the repeat could move is a ball that is there to be moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
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

it("launches nothing on the auto-repeat of a held key", async () => {
  await isolate(h);
  await h.debug.parkBall();

  const after = await captureReplay(h, "repeat", async () => {
    await h.keyDown(KEY);
    try {
      await h.settleFrame();
      await h.tick(5);
      await h.debug.parkBall();
      const reparked = await h.snapshot();
      assertTrue(
        reparked.balls.some((ball) => ball.parked),
        "a ball parked for the repeat to act on",
      );

      // The OS auto-repeat of the held key: a keydown with `repeat` set.
      await h.keyDown(KEY);
      await h.settleFrame();
      return await h.tick(5);
    } finally {
      await h.keyUp(KEY);
    }
  });

  assertLength(
    after.balls.filter((ball) => ball.parked),
    1,
    "the reparked ball still parked — the repeat armed no launch",
  );
});
