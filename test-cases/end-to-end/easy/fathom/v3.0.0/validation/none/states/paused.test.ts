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
//   * a hunter loose on the board rather than in the den, which patrols;
//   * a brightness of `POSED_BRIGHTNESS` under a full `BRIGHT_HOLD` (`1 s`) hold,
//     which then decays on the ordinary curve;
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
import { poseApart, spawnPredator } from "../fixtures";
import { parkForager } from "../scene";
import { assertEqual, assertGreaterThan } from "../assert";
import { drewText } from "../case-harness/text";
import { BRIGHT_HOLD, ticksFor } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  startPlaying,
} from "../harness";

import { MOVE_KEY, frameOps } from "./screens";

/** The roster index of the one hunter posed loose, on a board emptied of the rest. */
const LOOSE = 0;

/** How many tiles of corridor the hunter's own ring holds. */
const RING_TILES = 4;

/** How far that ring stands from the forager's room, in tiles. */
const APART_TILES = 10;

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
 * How long the paused dive is held, in ticks.
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

afterEach(async () => {
  await h.dispose();
});

it("freezes the dive behind its menu", async () => {
  await startPlaying(h);
  // The forager's room and, across solid rock, a ring for one hunter to patrol.
  // The pose empties the board, so the creature whose freezing this reads is the
  // only one on it.
  const rooms = await poseApart(h, APART_TILES, { ring: RING_TILES });
  await parkForager(h, rooms.near);
  await spawnPredator(h, "gloamfin", rooms.far, { state: "wander" });
  await h.debug.setBrightness(POSED_BRIGHTNESS);
  await h.debug.setBrightHold(BRIGHT_HOLD);
  await h.debug.setSonarCooldown(POSED_SONAR_COOLDOWN);
  await h.debug.setInkCooldown(POSED_INK_COOLDOWN);

  await h.debug.setScreen("paused");
  const paused = await h.snapshot();

  const ops = await frameOps(h);
  // Before the assertions, so a failing check still leaves the screen it read.
  await captureStill(h, "paused");

  const before = await h.snapshot();
  await h.hold(MOVE_KEY);
  await h.advance(FREEZE_TICKS);
  await h.release(MOVE_KEY);
  const after = await h.snapshot();

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
    "simulated seconds accumulated while the dive was paused, which every tick " +
      "adds to, the paused screen included (specs/state.md)",
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
    "the forager's brightness across a paused stretch longer than its hold and " +
      "its halflife together (specs/ui.md)",
  );
  assertEqual(
    after.sonar.cooldown,
    before.sonar.cooldown,
    "the sonar cooldown across a paused stretch longer than the cooldown posed " +
      "(specs/ui.md)",
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
});
