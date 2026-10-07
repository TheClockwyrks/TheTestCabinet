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
// Pin dart with `vx` `−600` and `vy` `0`.
//
// THE TOLERANCE. `REAL_EPS`: the specification fixes the direction and the
// speed and leaves how the build forms the velocity to it, so a build that
// turns the facing into an angle answers `sin(π) * 600`, a residue of `1e-13`,
// where the statement says `0`. A billionth admits every such residue and
// still fails a dart fired at any actual angle, where a single degree at 600
// is a `vy` of about 10.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { PIN_LEVELS, REAL_EPS } from "../constants";
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
  assertNear(darts[0].vx, -PIN_LEVELS[0].speed, REAL_EPS, "the dart's vx");
  assertNear(darts[0].vy, 0, REAL_EPS, "the dart's vy");
});
