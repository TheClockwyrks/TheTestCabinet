// movement/walk-speed-left — a held walk to the LEFT runs at the stated speed.
//
// `specs/character.md`: "Lateral movement. Holding left or right moves the miner
// horizontally at `WALK_SPEED`", which its table fixes at `250` units per second.
// So one second of held walk covers `250` units of ground, whichever way it runs.
//
// ONE DIRECTION PER POINT. `movement/walk-speed` decides the same requirement
// for the `right` binding, and this one decides it for `left`: a build whose
// `left` is dead, or whose leftward walk runs at a different speed, must grade
// differently from a build with both directions right.
//
// HOW THE SPEED IS READ. The key goes down through the surface's own input, the
// game's movement code moves the miner, and the window is a displacement divided
// by the game time it covered — never a posed velocity, so what is measured is
// the build's walk rather than an integration this file did.
//
// THE LEAD. The window opens after the key has already been held for a third of a
// second. `specs/character.md` states the speed of a held walk rather than how a
// build gets there, so a build that eases into it over a few frames satisfies the
// requirement and would read slow if the frame the key was first seen on were
// inside the window.
//
// THE ISOLATION. The drill is held: a walk into a minable cell is a cut, and this
// is a check about the walk. The floor is plain rock, which yields nothing, and
// the corridor ahead is open for the whole distance, so nothing stops the miner
// inside the window.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { WALK_SPEED } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  driveHold,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Far enough right that the whole leftward window runs over open floor. */
const COL = 24;
const ROW = 12;

/** Frames held before the window opens, and the frames the window runs for. */
const LEAD_FRAMES = 40;
const WINDOW_FRAMES = 120;

/** How far the measured speed may sit from the stated one. */
const SPEED_TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("walks 250 units per second to the left along the ground", async () => {
  await openScene(h);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW, "east");
  await pinDrill(h);

  const walk = await captureReplay(h, "walk", () =>
    driveHold(h, ACTION_KEY.left, WINDOW_FRAMES, { leadFrames: LEAD_FRAMES }),
  );

  assertEqual(
    walk.snapshot.miner.grounded,
    true,
    "the miner on the ground for the whole walk",
  );
  // Leftward, so the displacement is negative and the speed is its magnitude.
  const speed = (-walk.dx * TICK_HZ) / WINDOW_FRAMES;
  assertBetween(
    speed,
    WALK_SPEED * (1 - SPEED_TOLERANCE),
    WALK_SPEED * (1 + SPEED_TOLERANCE),
    "the walking speed, in units per second",
  );
});
