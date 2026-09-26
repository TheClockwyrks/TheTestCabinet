// screens/pause-freezes-the-mine — the pause menu stops the world.
//
// specs/ui.md: the `paused` screen shows "The pause menu over the frozen, dimmed
// world", and specs/controls.md binds `pause` in the mine to "Open the pause
// menu". Frozen means the simulation stops: a miner falling when the menu opened
// is exactly where it was, at exactly the speed it had, when the menu is still
// open half a minute of game time later, and it has spent no fuel in the
// meantime.
//
// FUEL IS THE SECOND WITNESS, and the more searching one. specs/character.md has
// life support burn `LIFE_SUPPORT_BURN` (0.4) a second "while below the surface
// ground line", so a build that merely stopped MOVING the miner while leaving its
// timers running is caught on the tank rather than on the position. The miner is
// underground for exactly that reason.
//
// ISOLATION. An empty mine with the miner dropped down it and no floor within
// reach, the drill gated so the pause key cannot start a cut, and nothing else in
// the world: no ore to bank, no gas to detonate, no lava to drain the hull.

import { afterEach, beforeEach, it } from "vitest";
import { LIFE_SUPPORT_BURN } from "../constants";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";

/** Where the fall starts, in an empty mine with hundreds of open rows below it. */
const COL = 16;
const START_ROW = 20;

/** The downward speed the fall opens at, so the miner is plainly in motion. */
const START_VY = 400;

/** Frames the fall runs for before the menu is opened. */
const FALL_FRAMES = 30;

/** The stretch of game time the menu is held open for. */
const PAUSED_SECONDS = 30;
const PAUSED_FRAMES = 60;

/** Half a unit: a frozen world moves by nothing at all. */
const TOLERANCE_DIGITS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the miner's position, speed and fuel while the menu is open", async () => {
  openScene(h);
  pinDrill(h);
  h.debug.setMinerPosition(minerXOn(COL), minerYOn(START_ROW));
  h.debug.setMinerVelocity(0, START_VY);
  await h.advance(FALL_FRAMES);

  const falling = h.snapshot();
  // The arrangement's own reading: the world really is running, and the miner
  // really is underground, so freezing it is a change rather than a no-op.
  assertGreaterThan(
    falling.miner.vy,
    0,
    "the miner is falling when the menu opens",
  );
  assertGreaterThan(
    falling.depthMeters,
    0,
    "the miner is below the ground line",
  );

  await h.tap(ACTION_KEY.pause);
  const paused = h.snapshot();
  assertEqual(
    paused.screen,
    "paused",
    "specs/controls.md: pause opens the pause menu during play",
  );

  await captureReplay(h, "frozen", () =>
    h.advanceSeconds(PAUSED_SECONDS, PAUSED_FRAMES),
  );

  const held = h.snapshot();
  assertCloseTo(
    held.miner.y,
    paused.miner.y,
    TOLERANCE_DIGITS,
    `specs/ui.md: the world is frozen behind the pause menu, after ${PAUSED_SECONDS}s`,
  );
  assertCloseTo(
    held.miner.vy,
    paused.miner.vy,
    TOLERANCE_DIGITS,
    "specs/ui.md: the miner keeps the speed it was falling at",
  );
  assertCloseTo(
    held.miner.fuel,
    paused.miner.fuel,
    TOLERANCE_DIGITS,
    `specs/ui.md: no fuel is spent while paused, though life support burns ${LIFE_SUPPORT_BURN}/s underground`,
  );
  assertEqual(
    held.screen,
    "paused",
    "specs/ui.md: the pause menu stays open until it is closed",
  );
});
