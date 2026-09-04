// instrumentation/debug-api — the build returned its debug and automation
// surface beside its state, and that surface is whole, really backed by the
// state the build declared, and really poses the game.
//
// TWO HALVES, AND BOTH OF THEM ARE THE BUILD'S. Under this engine `initialize`
// returns the pair `[state, debug]` and the engine hands the second element back
// from `engine.debug` (specs/instrumentation.md), so every operation, the
// version, and the snapshot shape are deliverables of this point. Nothing else
// in this project can be decided against a build that never returned one.
//
// The first half is that it is THERE. The harness reads it off `engine.debug`
// and never builds one, and a build that returned no surface fails at the moment
// a check first reaches for an operation on it — which is here, by name, rather
// than in some other check's setup.
//
// The second is the state behind it. A surface whose operations are present and
// whose snapshot reports zeroes is present and useless, so the shape is read off
// a game that has been driven and posed, and each pose is read back through the
// field the snapshot documents for it.
//
// THE CLOCK IS NOT ON THE SURFACE AND IS NOT READ HERE. specs/instrumentation.md
// gives the frame loop, the keyboard, and the overlay to the engine under this
// engine, so demanding an operation for any of them would fail a conformant
// build. A check steps the game with a clock of its own instead, and the
// `movement` points are what decide that the game consumes the time it is given.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNull,
  fail,
} from "../assert";
import {
  COIL_DEBUG_VERSION,
  COMBO_MAX,
  DIRECTIONS,
  SCREENS,
  START_CELLS,
  TICK_SECONDS,
  TITLE_ITEM_COUNT,
} from "../constants";
import {
  captureStill,
  chainFrom,
  clearObstacles,
  createHarness,
  FRAMES_PER_TICK,
  obstacleSurface,
  poseScene,
  type Harness,
} from "../harness";
import { OBSTACLE_OPS, REQUIRED_OPS } from "../surface";

/** The chain this point poses to read the surface against, head first. */
const POSED_HEAD = { col: 12, row: 6 };

/**
 * The screen the highlight is read on.
 *
 * specs/ui.md gives `title` a menu of `TITLE_ITEMS`, so index `1` is an item
 * that menu holds and `setMenuIndex` may be handed it.
 */
const MENU_SCREEN = "title";

let h: Harness;

/** The surface as a bag of members, which is how a probe reads one by name. */
function members(): Record<string, unknown> {
  return h.debug as unknown as Record<string, unknown>;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns its surface from initialize, and the engine hands it back", () => {
  // Reaching for a member is what decides this: the harness reads the surface
  // off `engine.debug` alone, so a build that returned no pair, or a pair whose
  // second element is not a surface, fails right here with what it owes named.
  assertEqual(typeof members().version, "number", "engine.debug.version");
});

it("carries its version and every operation its mode names, as functions", () => {
  const probed = members();
  assertEqual(probed.version, COIL_DEBUG_VERSION, "COIL_DEBUG_VERSION");
  for (const op of REQUIRED_OPS) {
    assertEqual(typeof probed[op], "function", `engine.debug.${op}`);
  }

  // The two obstacle operations are laid by an obstacle-placing mode alone, so
  // their absence is a fault only in a build whose snapshot reports such a mode.
  // `obstacleSurface` decides that at the one moment the mode is known, and
  // fails the point by name when the mode lays cells and the operations are not
  // there.
  if (obstacleSurface(h) !== null) {
    for (const op of OBSTACLE_OPS) {
      assertEqual(typeof probed[op], "function", `engine.debug.${op}`);
    }
  }
});

it("reports the whole documented snapshot shape, off a driven game", async () => {
  poseScene(h, {
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
  captureStill(h, "state");
  const s = h.snapshot();

  assertEqual(s.version, COIL_DEBUG_VERSION);
  assertContains(SCREENS, s.screen);
  assertEqual(typeof s.menuIndex, "number", "menuIndex");
  assertEqual(typeof s.titleIndex, "number", "titleIndex");
  assertContains(["classic", "maze"], s.mode);
  assertEqual(typeof s.score, "number", "score");
  assertEqual(typeof s.best, "number", "best");
  assertEqual(typeof s.combo, "number", "combo");
  assertEqual(typeof s.comboWindow, "number", "comboWindow");
  assertEqual(typeof s.muted, "boolean", "muted");
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
  debug.reset();
  // The mode's own obstacle course is furniture this reading is not about, and a
  // chain may not be posed across it, so it is taken off first. Under a mode
  // that lays none this changes nothing.
  clearObstacles(h);

  // Each pose sets one thing and is read back through the field the snapshot
  // documents for it, so an operation that is present but inert is caught here
  // rather than by whichever later point happened to lean on it.
  const chain = chainFrom(POSED_HEAD, "down", 5);
  debug.setSnake(chain);
  debug.setDirection("down");
  debug.clearTurns();
  debug.setPellet(20, 6);
  debug.setScore(70);
  debug.setBest(410);
  debug.setCombo(COMBO_MAX);
  debug.setComboWindow(1.5);
  debug.setSnakeSteering(false);
  debug.setSnakeTravel(false);
  debug.setPelletRespawn(false);
  debug.setScreen("playing");

  const posed = h.snapshot();
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
  const held = h.snapshot();
  assertDeepEqual(held.snake, chain, "the posed chain a tick later");
  assertEqual(held.score, 70, "the posed score a tick later");

  debug.clearPellet();
  assertNull(h.snapshot().pellet, "clearPellet");

  // The highlight, on a screen that carries a menu.
  debug.setScreen(MENU_SCREEN);
  debug.setMenuIndex(TITLE_ITEM_COUNT - 1);
  const menu = h.snapshot();
  assertEqual(menu.screen, MENU_SCREEN, "setScreen to a menu screen");
  assertEqual(menu.menuIndex, TITLE_ITEM_COUNT - 1, "setMenuIndex");

  // And the reading that reports where the build DREW that item, which
  // specs/instrumentation.md words as a region in logical units and specs/ui.md
  // makes the region a pointer selects the item from. What a pointer over it
  // does is the `pointer` and `touch` points; what is read here is that the
  // reading answers a region at all, and answers `null` where it says it does.
  const region = debug.menuItemRect(TITLE_ITEM_COUNT - 1);
  if (region === null) {
    return fail(
      `menuItemRect(${TITLE_ITEM_COUNT - 1}) to report the hit region of that ` +
        `item on the ${MENU_SCREEN} menu (specs/instrumentation.md)`,
      region,
    );
  }
  for (const side of ["x", "y", "w", "h"] as const) {
    assertEqual(typeof region[side], "number", `menuItemRect().${side}`);
  }
  assertGreaterThan(region.w, 0, "the width of the item's hit region");
  assertGreaterThan(region.h, 0, "the height of the item's hit region");

  debug.setScreen("playing");
  assertNull(
    debug.menuItemRect(0),
    "menuItemRect on playing, which shows no menu",
  );

  // And a reset returns the whole of it to the opening state.
  debug.reset();
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "reset");
  assertEqual(opened.titleIndex, 0, "reset");
  assertDeepEqual(opened.snake, [...START_CELLS], "reset");
  assertEqual(opened.score, 0, "reset");
});
