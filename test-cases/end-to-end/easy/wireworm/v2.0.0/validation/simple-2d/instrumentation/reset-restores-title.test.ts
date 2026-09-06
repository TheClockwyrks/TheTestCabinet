// Wireworm — instrumentation/reset-restores-title: `reset` returns every declared
// field to its title value, and leaves the mute bit alone.
//
// specs/instrumentation.md lists the title values `reset` restores, one by one:
// `screen` `"title"`, `phase` `"banner"`, `phaseTimer` `0`, `menuIndex` `0`,
// `score` `0`, `lives` `START_LIVES` (`3`), `level` `1`, `reachedLevel` `1`; the
// node field and the worm, foe, bolt and arc rosters emptied; the cursor at the
// band's center `(640, 688)` with `0` seconds of invulnerability and its contact
// test on; `fireCooldown` `0`; the world gates `foeSpawning` and `wormEntry` back
// on; and `simTime` `0`.
//
// WHY IT MATTERS BEYOND ITS OWN POINT. `reset` is the operation that gives a
// scenario a clean start: a check that reuses a harness across scenarios calls it
// first, and a `reset` that leaves a score, a life count or a standing node
// behind carries one scenario into the next.
//
// MUTE IS THE ONE EXCEPTION, AND IT IS READ RATHER THAN REQUIRED.
// specs/instrumentation.md leaves `muted` exactly as it stands, because muting is
// a player preference the runtime owns. A check made on a board that was never
// muted would pass whatever `reset` did to the bit, so this one drives the real
// `mute` binding first — the only route there is, since there is no `setMuted` —
// reads whatever bit that produced, and requires the reset to hand back the same
// bit. Whether the binding works at all is `controls.mute-m`'s point and not
// this one's, so what is asserted is the equality and never the value: a build
// whose mute does nothing is named by that point, not docked twice here.
//
// THE READING IS TAKEN BEFORE THE STILL'S FRAME. `simTime` is `0` immediately
// after the reset and one frame's delta after the frame that draws the title, so
// the snapshot is read first and the frame is run after it.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_TOP_ROW, COLS, START_LIVES, tileCY } from "../constants";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  createHarness,
  poseBolt,
  poseField,
  poseFoe,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The run posed before the reset: none of these is a title value. */
const SCORE = 8600;
const LIVES = 1;
const LEVEL = 6;
const REACHED_LEVEL = 6;
const MENU_INDEX = 1;
const PHASE_TIMER = 0.9;
const INVULNERABLE = 1.5;
const FIRE_COOLDOWN = 0.12;

/** Where the cursor is parked before the reset: not the band's center. */
const CURSOR_X = 120;
const CURSOR_Y = tileCY(BAND_TOP_ROW);

/** How long the posed run is left to run, so `simTime` is plainly not zero. */
const PLAY_TICKS = ticksFor(0.25);

/** Six decimal places: float noise, not a rounding a build may choose. */
const EXACT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores every title value and leaves muted as it stands", async () => {
  // Mute first, through the binding specs/controls.md fixes, because that is the
  // only route to the bit: there is no `setMuted` (specs/instrumentation.md).
  await h.tap("KeyM");
  const mutedBefore = h.snapshot().muted;

  // A run in progress: a score, a level, a field, and every roster carrying
  // something.
  startPlaying(h);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  h.debug.setLevel(LEVEL);
  h.debug.setReachedLevel(REACHED_LEVEL);
  h.debug.setMenuIndex(MENU_INDEX);
  h.debug.setPhaseTimer(PHASE_TIMER);
  h.debug.setCursor(CURSOR_X, CURSOR_Y);
  h.debug.setCursorInvulnerable(INVULNERABLE);
  h.debug.setFireCooldown(FIRE_COOLDOWN);

  poseField(h, ["0123", "3210"], 4, 8);
  poseWorm(h, 10, 4, 3);
  poseFoe(h, "glitch", 24, 6);
  poseBolt(h, 34, 19);
  h.debug.setSpawnTimer("glitch", 3.3);
  h.debug.setSpawnTimer("dropper", 3.3);
  h.debug.setSpawnTimer("corruptor", 3.3);
  h.debug.setNextFoeEntry("glitch", 0, 9);
  h.debug.setNextFoeEntry("dropper", 5, 0);
  h.debug.setNextFoeEntry("corruptor", COLS - 1, 2);
  h.debug.setNextWormEntry("right");

  // Let it run, so `simTime` has plainly accumulated something to be cleared.
  await h.advance(PLAY_TICKS);

  h.debug.reset();
  const title = h.snapshot();

  // The title screen the reset returned to.
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(title.screen, "title", "reset restores screen");
  assertEqual(title.phase, "banner", "reset restores phase");
  assertCloseTo(title.phaseTimer, 0, EXACT, "reset restores phaseTimer");
  assertEqual(title.menuIndex, 0, "reset restores menuIndex");
  assertEqual(title.score, 0, "reset restores score");
  assertEqual(title.lives, START_LIVES, "reset restores lives to START_LIVES");
  assertEqual(title.level, 1, "reset restores level");
  assertEqual(title.reachedLevel, 1, "reset restores reachedLevel");

  assertLength(title.nodes, 0, "reset empties the node field");
  assertLength(title.worms, 0, "reset empties the worm roster");
  assertLength(title.foes, 0, "reset empties the foe roster");
  assertLength(title.bolts, 0, "reset empties the bolt roster");
  assertLength(title.arcs, 0, "reset empties the arc roster");

  assertCloseTo(
    title.cursor.x,
    BAND_CX,
    EXACT,
    "reset places the cursor at the band's center x (specs/board.md)",
  );
  assertCloseTo(
    title.cursor.y,
    BAND_CY,
    EXACT,
    "reset places the cursor at the band's center y (specs/board.md)",
  );
  assertCloseTo(
    title.cursor.invulnerable,
    0,
    EXACT,
    "reset clears the cursor's invulnerability",
  );
  assertEqual(
    title.cursor.contact,
    true,
    "reset turns the cursor's contact test back on",
  );
  assertCloseTo(title.fireCooldown, 0, EXACT, "reset clears the fire cooldown");

  assertEqual(title.foeSpawning, true, "reset turns foe spawning back on");
  assertEqual(title.wormEntry, true, "reset turns worm entry back on");
  assertCloseTo(
    title.glitchTimer,
    0,
    EXACT,
    "reset sets the glitch clock to 0",
  );
  assertCloseTo(
    title.dropperTimer,
    0,
    EXACT,
    "reset sets the dropper clock to 0",
  );
  assertCloseTo(
    title.corruptorTimer,
    0,
    EXACT,
    "reset sets the corruptor clock to 0",
  );
  assertEqual(title.nextWormEntry, null, "reset clears the posed worm entry");
  assertEqual(
    title.nextGlitchEntry,
    null,
    "reset clears the posed glitch entry",
  );
  assertEqual(
    title.nextDropperEntry,
    null,
    "reset clears the posed dropper entry",
  );
  assertEqual(
    title.nextCorruptorEntry,
    null,
    "reset clears the posed corruptor entry",
  );
  assertCloseTo(title.simTime, 0, EXACT, "reset returns simTime to zero");

  // And the one field it must NOT touch.
  assertEqual(
    title.muted,
    mutedBefore,
    "reset leaves muted exactly as it stands: muting is a player preference " +
      "the runtime owns (specs/instrumentation.md)",
  );
});
