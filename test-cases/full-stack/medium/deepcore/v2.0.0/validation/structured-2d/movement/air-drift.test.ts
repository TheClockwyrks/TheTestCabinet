// movement/air-drift — lateral movement works in the air as well as on the ground.
//
// `specs/character.md`: "Holding left or right moves the miner horizontally at
// `WALK_SPEED`, on the ground and in the air alike." What that buys a player is a
// fall that can be steered: a plunge down one shaft can be walked sideways into
// the next on the way past, which is most of how the mine is travelled once a
// route is carved.
//
// So this reads the same `250` units per second the ground walk runs at, off a
// miner that is demonstrably airborne for the whole window — the mine is open
// beneath it, so it is falling the entire time, and the reading is of the
// horizontal component alone. That the drift costs `AIR_BURN` fuel belongs to the
// fuel checks; that a walk on the ground runs at this speed belongs to
// `walk-speed`.
//
// The window opens after the key has been held a third of a second, so a build
// that eases into the drift is read at the speed it holds rather than at the ramp.

import { afterEach, beforeEach, it } from "vitest";
import { WALK_SPEED } from "../../src/constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  driveHold,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  placeAt,
  TICK_HZ,
  type Harness,
} from "../harness";

const COL = 6;
/** The row the miner is let go in: open mine above and far below it. */
const ROW = 20;

const LEAD_FRAMES = 40;
const WINDOW_FRAMES = 120;
const SPEED_TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drifts 250 units per second sideways while falling", async () => {
  openScene(h);
  pinDrill(h);
  placeAt(h, minerXOn(COL), minerYOn(ROW));

  const drift = await captureReplay(h, "drift", () =>
    driveHold(h, ACTION_KEY.right, WINDOW_FRAMES, { leadFrames: LEAD_FRAMES }),
  );

  // Airborne for the window, and falling: the drift is a drift rather than a walk
  // along something the miner found to stand on.
  assertEqual(
    drift.snapshot.miner.grounded,
    false,
    "the miner airborne for the whole drift",
  );
  assertGreaterThan(drift.dy, 0, "the miner descending through the drift");

  const speed = (drift.dx * TICK_HZ) / WINDOW_FRAMES;
  assertBetween(
    speed,
    WALK_SPEED * (1 - SPEED_TOLERANCE),
    WALK_SPEED * (1 + SPEED_TOLERANCE),
    "the lateral drift speed in the air, in units per second",
  );
});
