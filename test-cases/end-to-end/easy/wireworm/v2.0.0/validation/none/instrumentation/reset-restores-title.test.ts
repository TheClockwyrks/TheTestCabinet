// Wireworm — instrumentation/reset-restores-title: `reset()` puts every declared
// field back to the title-screen value the specification lists, and leaves
// `muted` where it stands.
//
// specs/instrumentation.md writes the list out in one sentence: `reset` restores
// `screen` to `"title"`, `phase` to `"banner"`, `phaseTimer` to `0`, `menuIndex`
// to `0`, `score` to `0`, `lives` to `START_LIVES` (`3`), `level` to `1`, and
// `reachedLevel` to `1`; it empties the node field and the worm, foe, bolt, and
// arc rosters; it places the cursor at the band's centre, `(640, 688)`, with `0`
// seconds of invulnerability and its contact test on; it sets `fireCooldown` to
// `0`, turns the world gates `foeSpawning` and `wormEntry` back on, clears the
// level's spawner clocks, and sets `simTime` to `0`. Every one of those is read
// below, in that order, except the spawner clocks, which no field of the
// snapshot reports.
//
// EVERY FIELD IS POSED AWAY FROM ITS TITLE VALUE FIRST. A reset that restored
// nothing would pass on a game still sitting at the title, so the run this
// point resets is one in which not a single one of those fields holds the value
// it is about to be restored to: a score, a level and a reached level well into
// a run, one life, a menu row that is not the first, a screen and a phase that
// are neither, a cursor away from the band's centre with invulnerability
// running, a fire cooldown, all four rosters carrying entries, a live discharge
// arcing, both world gates held off, and accumulated simulation time.
//
// `muted` IS THE ONE FIELD THAT MUST SURVIVE. "`muted` is left exactly as it
// stands, because muting is a player preference the runtime owns"
// (specs/instrumentation.md), so the bit is read immediately before the reset
// and held to that same reading afterwards. The `mute` binding is pressed first
// so the bit under test is more likely to be the interesting one, but the
// comparison is against what the snapshot ACTUALLY reported a moment earlier —
// whether that binding works is `controls/mute-m`'s point, and a build that
// failed it must not fail this one too.
//
// THE ARCS ARE DRIVEN, NOT POSED. `arcs` is "empty except during the `ARC_LIFE`
// (`0.32` s) window after a detonation" (specs/discharge.md), so the only way to
// hold `reset` to emptying that roster is to detonate a critical node and reset
// inside the window.
//
// NO FRAME RUNS BETWEEN THE RESET AND THE READING. The harness holds the game off
// the wall clock, and `simTime` "accumulates every update's delta, whatever the
// screen" — so a check that advanced a frame first would be reading the update
// rather than the reset.

import { afterEach, beforeEach, it } from "vitest";
import {
  ARC_LIFE,
  BAND_CX,
  BAND_CY,
  BINDINGS,
  CHARGE_MAX,
  CURSOR_Y_MIN,
  START_LIVES,
} from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseBolt,
  poseFoe,
  poseWorm,
  startPlaying,
  type FoeKind,
  type Harness,
} from "../harness";

/**
 * How far the restored cursor may sit from the band's centre, in logical units.
 *
 * `1e-6`, which is float noise rather than a tolerance on the rule: the
 * specification names one exact point, `(640, 688)`, and a build placing the
 * cursor anywhere else has not restored it. Expressed as decimal digits for
 * `assertCloseTo`.
 */
const PLACE_DIGITS = 6;

/** The run posed before the reset — not one of these is a title-screen value. */
const SCORE = 8800;
const LIVES = 1;
const LEVEL = 6;
const REACHED_LEVEL = 6;
const MENU_INDEX = 1;
const SCREEN = "paused" as const;
const PHASE = "respawn" as const;
const PHASE_TIMER = 0.9;
const CURSOR_X = 1200;
const CURSOR_Y = CURSOR_Y_MIN;
const INVULNERABLE = 1.75;
const FIRE_COOLDOWN = 0.12;

/** The tiles the posed nodes stand on, and the charge each holds. */
const NODE_ROW = 5;
const NODE_COLS = [2, 4, 6] as const;
const NODE_CHARGE = 2;

/** Where the posed worms and foes stand. */
const WORM_ROW = 2;
const WORM_COLS = [12, 20] as const;
const WORM_LENGTH = 3;
const FOE_ROW = 14;
const FOE_COLS = [4, 10, 16] as const;
const KINDS: readonly FoeKind[] = ["glitch", "dropper", "corruptor"];

/**
 * The fuse: a critical node with one charged neighbour a tile away, which
 * specs/discharge.md puts well inside the chain's Chebyshev radius of `2`, and
 * the column a bolt climbs to it. Five rows separate it from the posed nodes
 * and four from the foes, so the discharge reaches nothing else.
 */
const FUSE_C = 30;
const FUSE_R = 10;
const NEIGHBOUR_C = 31;
const BOLT_R = 19;

/** A clear column for the second posed bolt, which holds nothing above it. */
const CLEAR_C = 36;

/**
 * How long the fuse bolt is given to reach the critical node, in seconds.
 *
 * Nine rows is `288` logical units and specs/cursor.md fixes `BOLT_SPEED` at
 * `900` units per second, so `0.32` s is the figure and one second is three
 * times it: a build with a slower bolt still detonates here and is graded on its
 * speed by `cursor/bolt-speed`.
 */
const FUSE_ALLOWANCE = 1;

/** Seconds of accumulated play, so `simTime` is something to be reset from. */
const PLAY_SECONDS = 0.4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("restores every declared field to its title value and leaves muted alone", async () => {
  // The runtime's mute bit, reached the only way there is: the real binding
  // (specs/instrumentation.md, What the runtime provides instead).
  await h.tap(BINDINGS.mute[0]);

  await startPlaying(h);
  await h.advance(framesFor(PLAY_SECONDS));

  // The fuse, lit first so the reset below lands while its arcs are still live.
  await h.debug.setNode(FUSE_C, FUSE_R, CHARGE_MAX);
  await h.debug.setNode(NEIGHBOUR_C, FUSE_R, 1);
  await poseBolt(h, FUSE_C, BOLT_R);
  const fired = await h.until((s) => s.arcs.length > 0, {
    maxFrames: framesFor(FUSE_ALLOWANCE),
  });
  assertTrue(
    fired.hit,
    `a discharge to be arcing within ${FUSE_ALLOWANCE} s of the bolt being ` +
      `placed under the critical node on tile (${FUSE_C}, ${FUSE_R}) — this ` +
      `point cannot hold reset to emptying an arc roster that never filled`,
  );

  // The rest of the run, posed inside the ARC_LIFE window so every roster is
  // carrying something at the moment of the reset.
  for (const c of NODE_COLS) await h.debug.setNode(c, NODE_ROW, NODE_CHARGE);
  for (const c of WORM_COLS) {
    await poseWorm(h, { c, r: WORM_ROW, length: WORM_LENGTH, stepping: false });
  }
  for (const [index, kind] of KINDS.entries()) {
    await poseFoe(h, kind, FOE_COLS[index], FOE_ROW, {
      travel: false,
      mind: false,
    });
  }
  await poseBolt(h, CLEAR_C, BOLT_R);

  await h.debug.setScore(SCORE);
  await h.debug.setLives(LIVES);
  await h.debug.setLevel(LEVEL);
  await h.debug.setReachedLevel(REACHED_LEVEL);
  await h.debug.setMenuIndex(MENU_INDEX);
  await h.debug.setPhaseTimer(PHASE_TIMER);
  await h.debug.setCursor(CURSOR_X, CURSOR_Y);
  await h.debug.setCursorInvulnerable(INVULNERABLE);
  await h.debug.setFireCooldown(FIRE_COOLDOWN);
  await h.debug.setFoeSpawning(false);
  await h.debug.setWormEntry(false);
  await h.debug.setScreen(SCREEN);
  await h.debug.setPhase(PHASE);

  const before = await h.snapshot();
  assertGreaterThan(
    before.simTime,
    0,
    "the simulation time accumulated before the reset, which specs/" +
      "instrumentation.md has reset return to 0 — with none accrued there " +
      "would be nothing to restore",
  );

  await h.debug.reset();
  // Read with no frame between: simTime accumulates every update's delta, so a
  // frame run between the reset and this reading would be reading the update.
  const title = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing reset still leaves the picture of the
  // screen it produced.
  await captureStill(h, "title");

  assertEqual(title.screen, "title", "snapshot().screen after reset()");
  assertEqual(title.phase, "banner", "snapshot().phase after reset()");
  assertEqual(title.phaseTimer, 0, "snapshot().phaseTimer after reset()");
  assertEqual(title.menuIndex, 0, "snapshot().menuIndex after reset()");
  assertEqual(title.score, 0, "snapshot().score after reset()");
  assertEqual(
    title.lives,
    START_LIVES,
    `snapshot().lives after reset(), which specs/instrumentation.md restores ` +
      `to START_LIVES (${START_LIVES})`,
  );
  assertEqual(title.level, 1, "snapshot().level after reset()");
  assertEqual(title.reachedLevel, 1, "snapshot().reachedLevel after reset()");

  assertLength(title.nodes, 0, "the nodes standing after reset()");
  assertLength(title.worms, 0, "the worms on the board after reset()");
  assertLength(title.foes, 0, "the foes on the board after reset()");
  assertLength(title.bolts, 0, "the bolts in flight after reset()");
  assertLength(
    title.arcs,
    0,
    `the links being arced after reset(), taken inside the ARC_LIFE ` +
      `(${ARC_LIFE} s) window of a live discharge`,
  );

  assertCloseTo(
    title.cursor.x,
    BAND_CX,
    PLACE_DIGITS,
    "snapshot().cursor.x after reset(), which specs/instrumentation.md places " +
      "at the band's centre",
  );
  assertCloseTo(
    title.cursor.y,
    BAND_CY,
    PLACE_DIGITS,
    "snapshot().cursor.y after reset(), which specs/instrumentation.md places " +
      "at the band's centre",
  );
  assertEqual(
    title.cursor.invulnerable,
    0,
    "snapshot().cursor.invulnerable, in seconds, after reset()",
  );
  assertEqual(
    title.cursor.contact,
    true,
    "snapshot().cursor.contact after reset(), which restores the gate to on",
  );
  assertEqual(title.fireCooldown, 0, "snapshot().fireCooldown after reset()");
  assertEqual(
    title.foeSpawning,
    true,
    "snapshot().foeSpawning after reset(), which restores the gate to on",
  );
  assertEqual(
    title.wormEntry,
    true,
    "snapshot().wormEntry after reset(), which restores the gate to on",
  );
  assertEqual(title.simTime, 0, "snapshot().simTime after reset()");

  // And the one field reset must not touch.
  assertEqual(
    title.muted,
    before.muted,
    "snapshot().muted after reset(), against the bit the snapshot reported a " +
      "moment before it — muting is a player preference the runtime owns, and " +
      "reset leaves it exactly as it stands",
  );
});
