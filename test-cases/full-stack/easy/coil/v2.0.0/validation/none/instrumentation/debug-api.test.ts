// instrumentation/debug-api — the build installed its debug and automation
// surface on `window.__coil`, and that surface is whole, really backed by the
// state the build declared, and really in control of the game's clock.
//
// THREE HALVES, AND ALL OF THEM ARE THE BUILD'S. An engineless run seeds no
// `src/` at all, so the surface itself — every operation, the version, the
// snapshot shape — and the global it is installed on are deliverables of this
// point (specs/instrumentation.md). Nothing else in this project can be decided
// against a build that never installed it.
//
// The first half is that it is THERE. The harness reports a missing or hollow
// surface as `surfaceFault` rather than by throwing, so the fault lands here, by
// name, rather than in some other check's setup.
//
// The second is the state behind it. A surface whose operations are present and
// whose snapshot reports zeroes is present and useless, so the shape is read off
// a game that has been driven and posed, and each pose is read back through the
// field the snapshot documents for it.
//
// The third is the CLOCK, which exists under this engine alone. Nothing outside
// an engineless build owns its loop, so `setAutoStep` and `advance` are on the
// surface and every other check in this project rests on them: a build whose
// `setAutoStep(false)` does not really disconnect the wall clock, or whose
// `advance` does not really run whole frames, hands every other check a scenario
// that drifts under it.
//
// The keyboard and the overlay are NOT on the surface. specs/instrumentation.md
// gives them to the runtime layer an engineless build writes, so demanding them
// here would fail a conformant build. The `controls` points press real keys.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import {
  COIL_DEBUG_VERSION,
  COMBO_MAX,
  DIRECTIONS,
  MENU_SCREENS,
  SCREENS,
  START_CELLS,
  TICK_SECONDS,
} from "../constants";
import {
  captureStill,
  chainFrom,
  clearObstacles,
  createHarness,
  failSurface,
  FRAME_HZ,
  FRAMES_PER_TICK,
  HANDLE,
  OBSTACLE_OPS,
  obstacleSurface,
  poseScene,
  REQUIRED_OPS,
  type Harness,
} from "../harness";

/** Real time allowed to pass with the game off the clock and nothing advancing it. */
const FROZEN_MS = 750;

/** The chain this point poses to read the surface against, head first. */
const POSED_HEAD = { col: 12, row: 6 };

let h: Harness;

/**
 * Fail with the harness's own account of what is missing, paired with what the
 * build owes.
 *
 * `assertNull(h.surfaceFault)` would read as "Expected: null" over the reason,
 * which throws away the half of the pair that says what the build owes, and this
 * is the point whose whole job is to name that plainly.
 */
function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`installs its surface on window.${HANDLE}`, async () => {
  requireSurface();
  const { version } = await h.probe([]);
  assertEqual(typeof version, "number", `window.${HANDLE}.version`);
});

it("carries its version and every operation its mode names, as functions", async () => {
  requireSurface();
  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(probed.version, COIL_DEBUG_VERSION, "COIL_DEBUG_VERSION");
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `window.${HANDLE}.${op}`);
  }

  // The two obstacle operations are laid by an obstacle-placing mode alone, so
  // their absence is a fault only in a build whose snapshot reports such a mode.
  // `obstacleSurface` decides that at the one moment the mode is known, and
  // fails the point by name when the mode lays cells and the operations are not
  // there.
  const obstacles = await obstacleSurface(h);
  if (obstacles !== null) {
    const laid = await h.probe(OBSTACLE_OPS);
    for (const op of OBSTACLE_OPS) {
      assertEqual(laid.ops[op], "function", `window.${HANDLE}.${op}`);
    }
  }
});

it("takes the game off the wall clock, and runs whole frames on demand", async () => {
  // The harness has already called `setAutoStep(false)`. So a round is posed and
  // real time is simply allowed to pass: a build still running itself off the
  // wall clock resolves ticks and moves the snake while this waits, and one that
  // really disconnected does not move at all.
  const posed = await poseScene(h, {
    snake: chainFrom(POSED_HEAD, "right", 3),
    dir: "right",
    pellet: null,
  });
  assertEqual(posed.autoStep, false, "autoStep after setAutoStep(false)");

  await h.page.waitForTimeout(FROZEN_MS);
  const still = await h.snapshot();
  assertEqual(still.ticks, posed.ticks, "ticks with the clock disconnected");
  assertCloseTo(
    still.simTime,
    posed.simTime,
    9,
    "simTime with it disconnected",
  );
  assertDeepEqual(still.snake, posed.snake, "the chain with it disconnected");

  // And an advance runs real frames: one second of game time is the eight ticks
  // specs/movement.md fixes, and the simulation moved with it.
  await h.advance(FRAME_HZ);
  const driven = await h.snapshot();
  assertEqual(driven.ticks, posed.ticks + FRAME_HZ / FRAMES_PER_TICK);
  assertCloseTo(driven.simTime - posed.simTime, 1, 6, "a second of game time");
  assertDeepEqual(driven.snake[0], {
    col: POSED_HEAD.col + 8,
    row: POSED_HEAD.row,
  });
});

it("reports the whole documented snapshot shape, off a driven game", async () => {
  await poseScene(h, {
    snake: chainFrom(POSED_HEAD, "right", 4),
    dir: "right",
    pellet: { col: 20, row: 6 },
    score: 120,
    best: 340,
    combo: 3,
    comboWindow: 2,
  });
  await h.tick(2);
  // The frame the snapshot below is read off: what the surface reports and what
  // the build drew, at the same instant, so the two can be held against each
  // other.
  await captureStill(h, "state");
  const s = await h.snapshot();

  assertEqual(s.version, COIL_DEBUG_VERSION);
  assertContains(SCREENS, s.screen);
  assertEqual(typeof s.menuIndex, "number", "menuIndex");
  assertContains(["classic", "maze"], s.mode);
  assertEqual(typeof s.score, "number", "score");
  assertEqual(typeof s.best, "number", "best");
  assertEqual(typeof s.combo, "number", "combo");
  assertEqual(typeof s.comboWindow, "number", "comboWindow");
  assertEqual(typeof s.muted, "boolean", "muted");
  assertEqual(typeof s.autoStep, "boolean", "autoStep");
  assertEqual(typeof s.ticks, "number", "ticks");
  assertEqual(typeof s.simTime, "number", "simTime");
  assertContains(DIRECTIONS, s.dir);
  assertEqual(Array.isArray(s.turns), true, "turns");
  assertEqual(Array.isArray(s.snake), true, "snake");
  assertEqual(Array.isArray(s.obstacles), true, "obstacles");
  assertEqual(typeof s.steering, "boolean", "steering");
  assertEqual(typeof s.travel, "boolean", "travel");
  assertEqual(typeof s.pelletRespawn, "boolean", "pelletRespawn");
  for (const cell of [...s.snake, ...s.obstacles]) {
    assertEqual(typeof cell.col, "number", "a cell's col");
    assertEqual(typeof cell.row, "number", "a cell's row");
  }
  assertEqual(
    s.pellet === null || typeof s.pellet.col === "number",
    true,
    "pellet",
  );

  // Live values rather than a shape filled with zeroes: the round the scene
  // posed has been ticked, so the clock, the figures and the chain all moved
  // with it and read back as the game holds them.
  assertEqual(s.screen, "playing");
  assertEqual(s.ticks, 2, "ticks after two driven ticks");
  assertCloseTo(s.simTime, 2 * TICK_SECONDS, 6, "simTime after two ticks");
  assertEqual(s.score, 120);
  assertEqual(s.best, 340);
  assertEqual(s.combo, 3);
  assertLength(s.snake, 4, "the posed chain");
  assertDeepEqual(s.snake[0], { col: POSED_HEAD.col + 2, row: POSED_HEAD.row });
});

it("poses the running game through each of its operations", async () => {
  const { debug } = h;
  await debug.reset();
  // The mode's own obstacle course is furniture this reading is not about, and a
  // chain may not be posed across it, so it is taken off first. Under a mode
  // that lays none this changes nothing.
  await clearObstacles(h);

  // Each pose sets one thing and is read back through the field the snapshot
  // documents for it, so an operation that is present but inert is caught here
  // rather than by whichever later point happened to lean on it.
  const chain = chainFrom(POSED_HEAD, "down", 5);
  await debug.setSnake(chain);
  await debug.setDirection("down");
  await debug.clearTurns();
  await debug.setPellet(20, 6);
  await debug.setScore(70);
  await debug.setBest(410);
  await debug.setCombo(COMBO_MAX);
  await debug.setComboWindow(1.5);
  await debug.setSnakeSteering(false);
  await debug.setSnakeTravel(false);
  await debug.setPelletRespawn(false);
  await debug.setScreen("playing");

  const posed = await h.snapshot();
  assertDeepEqual(posed.snake, chain, "setSnake");
  assertEqual(posed.dir, "down", "setDirection");
  assertDeepEqual(posed.turns, [], "clearTurns");
  assertDeepEqual(posed.pellet, { col: 20, row: 6 }, "setPellet");
  assertEqual(posed.score, 70, "setScore");
  assertEqual(posed.best, 410, "setBest");
  assertEqual(posed.combo, COMBO_MAX, "setCombo");
  assertCloseTo(posed.comboWindow, 1.5, 9, "setComboWindow");
  assertEqual(posed.steering, false, "setSnakeSteering");
  assertEqual(posed.travel, false, "setSnakeTravel");
  assertEqual(posed.pelletRespawn, false, "setPelletRespawn");
  assertEqual(posed.screen, "playing", "setScreen");

  // A pose holds across frames rather than being a one-frame nudge.
  await h.advance(FRAMES_PER_TICK);
  const held = await h.snapshot();
  assertDeepEqual(held.snake, chain, "the posed chain a tick later");
  assertEqual(held.score, 70, "the posed score a tick later");

  await debug.clearPellet();
  assertNull((await h.snapshot()).pellet, "clearPellet");

  // The highlight, on a screen that carries a menu.
  await debug.setScreen(MENU_SCREENS[0]);
  await debug.setMenuIndex(1);
  const menu = await h.snapshot();
  assertEqual(menu.screen, MENU_SCREENS[0], "setScreen to a menu screen");
  assertEqual(menu.menuIndex, 1, "setMenuIndex");

  // And a reset returns the whole of it to the opening state.
  await debug.reset();
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "reset");
  assertDeepEqual(opened.snake, [...START_CELLS], "reset");
  assertEqual(opened.score, 0, "reset");
});
