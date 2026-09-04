// states/paused — the pause screen freezes the dive.
//
// `specs/ui.md` routes the pause control from `"playing"` to `"paused"`, gives
// that screen as "the pause menu, over a maze that stays visible and frozen
// behind it", fixes the pause menu as `RESUME`, `RESTART`, `QUIT TO MENU` in that
// order, routes `RESUME` confirmed back to `"playing"`, and fixes what advances
// on it: "Nothing. The maze behind the menu is frozen."
//
// THE FREEZE IS MADE A REAL READING. Pausing a dive that has only just begun
// would compare a still forager against a still forager and two ready cooldowns
// against two ready cooldowns. So the dive is arranged first with four things
// that a running simulation would visibly move, every one of them posed through
// an operation `specs/instrumentation.md` gives:
//
//   * a hunter loose on the board, the only one on it, which patrols;
//   * a brightness of `POSED_BRIGHTNESS` with the `BRIGHT_HOLD` (`1 s`) hold
//     armed in full beside it, which then decays on the ordinary curve;
//   * two cooldowns plainly mid-run, which run down;
//   * a movement key held for the whole stretch, which travels the forager.
//
// and the stretch is FREEZE_TICKS long, chosen past every one of those clocks.
// On a build that keeps simulating, all four move; on a conforming one none of
// them does.
//
// AND THE TICKS REALLY RAN. `simTime` "accumulates on every screen, ... the menus
// and the paused screen included" (`specs/state.md`), so the same watch that
// finds nothing moved reads the clock moving, and a build that ignored `advance`
// cannot pass by standing still.
//
// WHAT THIS DOES NOT DECIDE. Where `RESTART` and `QUIT TO MENU` lead — this reads
// only that they are drawn, which is what `specs/ui.md` fixes about the menu's
// contents — and what the pause overlay looks like, which is the aesthetic
// rating's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BRIGHT_HOLD, PAUSE_ITEMS } from "../constants";
import { placeForager, poseMaze, spawnPredator } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  CONFIRM_KEY,
  MOVE_KEY,
  PAUSE_KEY,
  assertDrew,
  frameOps,
} from "./screens";
import {} from "../scene";

/**
 * The board: a straight run for the forager, and across solid rock a ring for the
 * one hunter to patrol, so nothing it does can reach the forager and end the
 * measurement.
 */
const BOARD = ["F........", "", "P...", "   .", "...."] as const;

/** The roster index posed loose, so something on the board would move if it could. */
const LOOSE = 0;

/**
 * The brightness posed before the pause, in `[0, 1]`.
 *
 * Mid-range, so a build that let the ordinary decay run would report a plainly
 * different number: `specs/sensing.md` halves `G` every `BRIGHT_HALFLIFE`
 * (`0.9 s`) once the `BRIGHT_HOLD` (`1 s`) hold posed beside it has expired.
 */
const POSED_BRIGHTNESS = 0.5;

/** The sonar cooldown posed before the pause, in seconds. Under SONAR_COOLDOWN. */
const POSED_SONAR_COOLDOWN = 1.2;

/** The ink cooldown posed alongside it, in seconds. Under INK_COOLDOWN. */
const POSED_INK_COOLDOWN = 5;

/**
 * How long the paused dive is held, in frames.
 *
 * Four seconds: past `BRIGHT_HOLD + BRIGHT_HALFLIFE` so a running decay would
 * have taken `G` below half of what was posed, past `POSED_SONAR_COOLDOWN` so a
 * running cooldown would have reached zero, and enough travel at `FORAGER_SPEED`
 * (`128`) to carry the forager sixteen tiles. Every clock this check reads is
 * inside it.
 */
const FREEZE_TICKS = ticksFor(4 * BRIGHT_HOLD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("freezes the dive behind its menu, and resumes", async () => {
  startPlaying(h);
  const board = await poseMaze(h, BOARD);
  await placeForager(h, board.mark("F"), "right");
  // One hunter, loose and patrolling its own ring: the only creature on the
  // board, and the one that is supposed to hold still behind the menu.
  await spawnPredator(h, "gloamfin", board.mark("P"));
  h.debug.setBrightness(POSED_BRIGHTNESS);
  h.debug.setBrightHold(BRIGHT_HOLD);
  h.debug.setBrightHold(BRIGHT_HOLD);
  h.debug.setSonarCooldown(POSED_SONAR_COOLDOWN);
  h.debug.setInkCooldown(POSED_INK_COOLDOWN);

  await h.tap(PAUSE_KEY);
  const paused = h.snapshot();

  const ops = await frameOps(h);
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "paused");

  const before = h.snapshot();
  h.hold(MOVE_KEY);
  await h.advance(FREEZE_TICKS);
  h.release(MOVE_KEY);
  const after = h.snapshot();

  await h.tap(CONFIRM_KEY); // RESUME, the first item of the pause menu.
  const resumed = h.snapshot();

  assertEqual(
    paused.screen,
    "paused",
    "the screen the pause control reaches from live play (specs/ui.md)",
  );
  for (const item of PAUSE_ITEMS) {
    assertDrew(
      ops,
      item,
      `an item of the pause menu, which is ${PAUSE_ITEMS.join(", ")} (specs/ui.md)`,
    );
  }
  assertDrew(
    ops,
    `DEPTH ${String(paused.depth)}`,
    "the HUD's depth readout, still drawn over the maze that stays visible " +
      "behind the pause menu (specs/ui.md)",
  );

  // The ticks really ran, so nothing below is vacuous.
  assertGreaterThan(
    after.simTime - before.simTime,
    0,
    "simulated seconds accumulated while the dive was paused, which every " +
      "tick adds to, the paused screen included (specs/state.md)",
  );

  assertEqual(
    after.forager.x,
    before.forager.x,
    "the forager's x across a paused stretch with a movement key held, behind " +
      "a screen on which nothing advances (specs/ui.md)",
  );
  assertEqual(
    after.forager.y,
    before.forager.y,
    "the forager's y across a paused stretch with a movement key held",
  );
  assertEqual(
    after.brightness,
    before.brightness,
    "the forager's brightness across a paused stretch longer than its hold " +
      "and its halflife together (specs/ui.md)",
  );
  assertEqual(
    after.sonar.cooldown,
    before.sonar.cooldown,
    "the sonar cooldown across a paused stretch longer than the cooldown " +
      "posed (specs/ui.md)",
  );
  assertEqual(
    after.ink.cooldown,
    before.ink.cooldown,
    "the ink cooldown across a paused stretch (specs/ui.md)",
  );
  assertEqual(
    `${String(after.predators[LOOSE].x)},${String(after.predators[LOOSE].y)}`,
    `${String(before.predators[LOOSE].x)},${String(before.predators[LOOSE].y)}`,
    `where the loose ${before.predators[LOOSE].kind} stood across a paused ` +
      "stretch, behind a maze that is frozen (specs/ui.md)",
  );

  assertEqual(
    resumed.screen,
    "playing",
    "the screen RESUME confirmed from the pause menu returns to (specs/ui.md)",
  );
});
