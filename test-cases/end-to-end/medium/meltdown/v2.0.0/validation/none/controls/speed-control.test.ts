// Meltdown — controls/speed-control: the panel's speed control toggles the game
// speed.
//
// specs/hud.md gives the control: "The panel carries... a game-speed toggle drawing
// whether the speed is `1` or `2`". specs/controls.md answers a press and release
// inside a panel control as "That control is operated", and gives `speed` the effect
// "Toggles the game speed between `1` and `2`." specs/waves.md names the field:
// "The game-speed toggle sets `speed` to `1` or `2`".
//
// TWO TAPS, BECAUSE THE REQUIREMENT IS A TOGGLE. One tap separates a build that
// answers the control from one that ignores it; the second separates a toggle from a
// build that latches the speed at `2` and never gives it back. The item's own
// description names both halves — "moves `speed` between 1 and 2".
//
// THE RECTANGLE IS RE-READ BETWEEN THE TWO TAPS. specs/hud.md has the control draw
// "whether the speed is `1` or `2`", so its contents change between the taps and a
// build is free to lay it out around them; taking the rectangle from the snapshot
// each time means the second tap lands where the panel now says the control is,
// rather than where it was.
//
// THE CONTROL AND THE KEY ARE SEPARATE POINTS. specs/controls.md requires that
// "Every interaction and every menu is reachable with the pointer alone", so a build
// with a working `KeyF` and a dead speed control fails here and not there;
// `controls.speed-key` reads the key.
//
// THE FIELD IS THE READING, NOT THE RATE. That the game really advances twice the
// game time per second of elapsed time at `2` is `waves.speed-doubles-the-rate`, and
// it is measured there on the build's own clock, because that is a claim about the
// clock the player is on. This point reads the toggle the player operates.
//
// THE RUN OPENS AT SPEED 1, POSED, so the first tap is a tap from a known setting.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tapControl,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the game speed to 2 on a tap of the reported speed rectangle and back to 1 on the next", async () => {
  await startRun(h);
  await h.advance(1);
  const before = await h.snapshot();
  assertEqual(before.speed, 1, "the speed the run is posed at");

  await tapControl(h, before.controls.speed);
  const once = await h.snapshot();
  await captureStill(h, "speed");

  await tapControl(h, once.controls.speed);
  const twice = await h.snapshot();

  assertEqual(
    once.speed,
    2,
    "the speed after one press and release inside the reported speed rectangle, from 1",
  );
  assertEqual(
    twice.speed,
    1,
    "the speed after a second press and release inside the reported speed rectangle, from 2",
  );
});
