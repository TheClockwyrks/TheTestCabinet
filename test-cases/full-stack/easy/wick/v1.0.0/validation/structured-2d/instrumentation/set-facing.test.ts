// Wick — instrumentation/set-facing: `setFacing('left')` on a lamplighter
// facing right reads back `facing` left, and a Pin dart fired on the next tick
// flies toward −x.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setFacing(facing)`: "Sets `facing` to `facing`, `"left"` or `"right"`."
// `specs/weapons.md`, Pin: "A dart is a circle of `radius`, fired horizontally
// in the facing direction at `speed`"; "The facing direction is ... `−x` for
// `"left"`"; level 1 fires one dart at 600. `specs/world.md`: a run starts
// facing `"right"`.
//
// THE DRIVE. An isolated run with Pin held and armed, the pose, one tick: one
// Pin dart with `vx` `−600` and `vy` `0`, exact, since a launch velocity is a
// stated speed along a unit axis.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { PIN_LEVELS } from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  projectilesOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads back left and fires the next dart toward −x", async () => {
  const start = isolate(h);
  assertEqual(start.run.player.facing, "right", "facing before the pose");
  const pin = holdWeapon(h, "pin");
  armWeapon(h, pin);

  h.debug.setFacing("left");
  assertEqual(
    h.snapshot().run.player.facing,
    "left",
    "facing after setFacing('left')",
  );

  const fired = await captureReplay(h, "faced", () => advanceTicks(h, 1));
  const darts = projectilesOf(fired, "pin");
  assertLength(darts, PIN_LEVELS[0].amount, "Pin darts fired on the next tick");
  assertEqual(darts[0].vx, -PIN_LEVELS[0].speed, "the dart's vx");
  assertEqual(darts[0].vy, 0, "the dart's vy");
});
