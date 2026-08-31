// Meltdown — controls/speed-key: KeyF toggles the game speed, and toggles back.
//
// THE RULE. specs/controls.md binds `speed` to `KeyF` and gives it the effect
// "Toggles the game speed between `1` and `2`." specs/waves.md names the field it
// moves — "The game-speed toggle sets `speed` to `1` or `2`" — and
// specs/instrumentation.md reports it as `speed`.
//
// TWO PRESSES, BECAUSE THE REQUIREMENT IS A TOGGLE. One press separates a build
// that answers the key from one that ignores it; the second separates a toggle
// from a build that latches the speed at `2` and never gives it back, and from one
// that runs fast only while the key is held. The item's own description names both
// halves — "moves `speed` between 1 and 2 and back".
//
// THE FIELD IS THE READING, NOT THE RATE. That the game really does advance twice
// the game time per second of elapsed time at `2` is
// `waves.speed-doubles-the-rate` — a claim about the clock the player is on, which
// that item measures over a window of the game's own time. This point reads the
// toggle the player operates.
//
// THE RUN OPENS AT SPEED 1, POSED. `startRun` sets the speed back to `1` through
// `setSpeed`, so the first press is a press from a known setting rather than from
// whatever the build happened to be left on, and the second reading is against
// that same known setting.
//
// THE WORLD IS AN EMPTY, QUIET, LIVE RUN. Nothing on the floor, no unit arriving
// and no wave starting, so the only thing that can move the speed is the key.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds `speed` to, and the only one. */
const KEY = BINDINGS.speed[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the game speed to 2 on a KeyF press and back to 1 on the next", async () => {
  startRun(h);
  await h.advance(1);
  assertEqual(
    h.snapshot().speed,
    1,
    "posing: the speed the run is posed at (specs/waves.md)",
  );

  await h.tap(KEY);
  captureStill(h, "speed");
  const once = h.snapshot().speed;

  await h.tap(KEY);
  const twice = h.snapshot().speed;

  assertEqual(
    once,
    2,
    `${KEY}: the speed after one press, from 1 (specs/controls.md, The actions)`,
  );
  assertEqual(
    twice,
    1,
    `${KEY}: the speed after a second press, back from 2 — the action is a ` +
      `toggle (specs/controls.md, The actions)`,
  );
});
