// states/paused — the pause screen freezes the dive.
//
// `specs/ui.md` gives the paused screen as "the pause menu, over a maze that
// stays visible and frozen behind it", and fixes what advances on it: "Nothing.
// The maze behind the menu is frozen." This point is that freeze, and the maze
// still being drawn behind the menu.
//
// THE FREEZE IS MADE A REAL READING. Pausing a dive that has only just begun
// would compare a still forager against a still forager and two ready cooldowns
// against two ready cooldowns. So the dive is arranged first with four things
// that a running simulation would visibly move, every one of them posed through
// an operation `specs/instrumentation.md` gives:
//
//   * a hunter loose on a sealed ring of its own, which patrols;
//   * a brightness of `POSED_BRIGHTNESS`, which `setBrightness` arms the
//     `BRIGHT_HOLD` (`1 s`) hold on and which then decays on the ordinary curve;
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
// WHAT THIS DOES NOT DECIDE. What PAUSES the dive, which is `controls.pause-esc`
// and `controls.pause-p`; what the menu DRAWS, which is
// `states.pause-menu-items`; where `RESUME`, `RESTART` and `QUIT TO MENU` lead,
// which are `states.resume-from-pause` and the two `navigation` points; and what
// the pause overlay looks like, which is the aesthetic rating's. The screen is
// reached through `setScreen` for exactly that reason: a longer route only adds
// failure modes that belong to other points.

import { afterEach, beforeEach, it } from "vitest";
import { BRIGHT_HOLD } from "../constants";
import { placeForager, poseApart, spawnPredator } from "../fixtures";

import { assertEqual, assertGreaterThan } from "../assert";
import { drewText } from "../case-harness/text";
import {
  captureStill,
  createHarness,
  poseBrightness,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { MOVE_KEY, frameOps } from "./screens";

/** How far apart the forager's room and the hunter's ring stand, in tiles. */
const APART_TILES = 12;

/** How much corridor the hunter's ring holds, in tiles. */
const RING_TILES = 3;

/**
 * The brightness posed before the pause, in `[0, 1]`.
 *
 * Mid-range, so a build that let the ordinary decay run would report a plainly
 * different number: `specs/sensing.md` halves `G` every `BRIGHT_HALFLIFE`
 * (`0.9 s`) once the `BRIGHT_HOLD` (`1 s`) hold `setBrightness` arms has expired.
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
const FREEZE_TICKS = ticks(4 * BRIGHT_HOLD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("freezes the dive behind its menu", async () => {
  await startPlaying(h);
  // The forager in its own room and, across solid rock, one hunter loose and
  // patrolling a ring of its own: the only body on the board besides the forager
  // is the one that is supposed to hold still.
  const rooms = await poseApart(h, APART_TILES, { ring: RING_TILES });
  await placeForager(h, rooms.near, "right");
  const loose = await spawnPredator(h, "lanternjaw", rooms.far, {
    state: "wander",
  });
  await poseBrightness(h, POSED_BRIGHTNESS, BRIGHT_HOLD);
  h.debug.setSonarCooldown(POSED_SONAR_COOLDOWN);
  h.debug.setInkCooldown(POSED_INK_COOLDOWN);

  h.debug.setScreen("paused");
  const paused = h.snapshot();

  const ops = await frameOps(h);
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "paused");

  const before = h.snapshot();
  h.hold(MOVE_KEY);
  await h.advance(FREEZE_TICKS);
  h.release(MOVE_KEY);
  const after = h.snapshot();

  assertEqual(
    paused.screen,
    "paused",
    "the screen this point's freeze is read on (specs/ui.md)",
  );
  assertEqual(
    drewText(ops, `DEPTH ${String(paused.depth)}`),
    true,
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
    `${String(after.predators[loose].x)},${String(after.predators[loose].y)}`,
    `${String(before.predators[loose].x)},${String(before.predators[loose].y)}`,
    `where the loose ${before.predators[loose].kind} stood across a paused ` +
      "stretch, behind a maze that is frozen (specs/ui.md)",
  );
});
