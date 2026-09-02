// Meltdown — instrumentation/reset-restores-title: reset returns the game to its
// title values.
//
// specs/instrumentation.md, The core: `reset(options)` "Restores every declared
// field of the state to its title-screen value", and then lists them outright —
// `screen` to `"title"`, `phase` to `"opening"`, `menuIndex` to `0`, `mode` to
// `"containment"`, `difficulty` to `"medium"`, `money` to the starting money that
// pair gives, `lives` to its starting lives, `score` to `0`, `wave` to `1`,
// `buildTimer` to `0`, `wavePending` to `0`, `speed` to `1`, `selected` to `null`,
// `hoverShop` to `null`, `build` to `null`, and `simTime` to `0`. "It empties the
// tower and surge rosters, clears the spawner's clock, and turns the world gate
// `waveSpawning` back on." Two fields are named as EXCEPTIONS: `muted` is "left
// exactly as it stands, because muting is a player preference the runtime owns",
// and so is `pointer`.
//
// EVERY FIELD IS DIRTIED FIRST, AND DIRTIED AWAY FROM ITS TITLE VALUE, so each
// restoration is a real restoration rather than a value that never moved. The run
// is put on a different mode and a different difficulty, on a later wave, with
// money, lives and a score no title screen carries, at speed `2`, with a tower
// selected and a preview armed over a shop entry the panel is hovering, with
// towers and units on the floor and the world gate held shut. A build that
// restores fourteen of the sixteen fields fails here naming the two it missed.
//
// THE STARTING MONEY AND LIVES ARE THE CASE'S OWN FIGURES for Containment Medium,
// read from the table `specs/modes.md` fixes rather than from the snapshot,
// because "the starting money that pair gives" is what the specification says
// `reset` restores. A build that derives that pair wrongly fails `modes`, and
// fails here too — which is correct: its `reset` really does leave the wrong money
// on the title screen.
//
// MUTE IS REACHED THE WAY A PLAYER REACHES IT. There is no `setMuted`
// (specs/instrumentation.md), so the bit is toggled through the `mute` action's
// own binding, `KeyM`, which specs/controls.md makes available "from any screen".
// That is what makes "left exactly as it stands" observable at all: the bit is
// `true` going into the reset, so a build that clears it is caught rather than
// agreeing with a default of `false`.
//
// THE READING IS TAKEN FROM THE RESET ITSELF, before any frame runs, because
// `simTime` is one of the restored fields: a frame between the pose and the read
// would advance it and the restoration could not be told from a build that never
// restored it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  poseWalker,
  startLivesOf,
  startMoneyOf,
  startRun,
  type Harness,
} from "../harness";
import { GUN } from "./scenes";

/** The pair the title screen rests on (specs/instrumentation.md). */
const TITLE_MODE = "containment";
const TITLE_DIFFICULTY = "medium";

/** The run posed before the reset: every figure off its title value. */
const DIRTY = {
  money: 4321,
  lives: 46,
  score: 90210,
  wave: 13,
  buildTimer: 7.25,
  wavePending: 9,
  speed: 2,
  menuIndex: 2,
} as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores every declared field, and leaves muted exactly as it stands", async () => {
  // Dirty everything: a different pair, a later wave, a floor with towers and
  // units on it, a selection, a hover, a held preview, the world gate shut.
  startRun(h, "bottleneck", "hard");
  const gun = poseTower(h, "arc", GUN.col, GUN.row);
  poseTower(h, "forge", GUN.col + 3, GUN.row);
  poseWalker(h, "mote", "left");
  poseWalker(h, "hulk", "top");

  h.debug.setScreen("paused");
  h.debug.setPhase("wave");
  h.debug.setMenuIndex(DIRTY.menuIndex);
  h.debug.setMoney(DIRTY.money);
  h.debug.setLives(DIRTY.lives);
  h.debug.setScore(DIRTY.score);
  h.debug.setWave(DIRTY.wave);
  h.debug.setBuildTimer(DIRTY.buildTimer);
  h.debug.setWavePending(DIRTY.wavePending);
  h.debug.setSpeed(DIRTY.speed);
  h.debug.setSelected(gun);
  h.debug.setHoverShop("lance");
  h.debug.setArmed("bloom");
  h.debug.setWaveSpawning(false);

  // The mute bit, through the action's own binding — the only way a build's
  // surface offers.
  await h.tap(BINDINGS.mute[0]);
  const dirty = h.snapshot();
  assertEqual(dirty.muted, true, "precondition: the mute bit was toggled on");

  // The reset, and the snapshot it left — read before any frame runs, so
  // `simTime` is the restored `0` and not a frame's tick.
  h.debug.reset();
  const title = h.snapshot();

  assertEqual(title.screen, "title", "screen");
  assertEqual(title.phase, "opening", "phase");
  assertEqual(title.menuIndex, 0, "menuIndex");
  assertEqual(title.mode, TITLE_MODE, "mode");
  assertEqual(title.difficulty, TITLE_DIFFICULTY, "difficulty");
  assertEqual(
    title.money,
    startMoneyOf(TITLE_MODE, TITLE_DIFFICULTY),
    "money: the starting money Containment Medium gives",
  );
  assertEqual(
    title.lives,
    startLivesOf(TITLE_MODE),
    "lives: the starting lives that mode gives",
  );
  assertEqual(title.score, 0, "score");
  assertEqual(title.wave, 1, "wave");
  assertEqual(title.buildTimer, 0, "buildTimer");
  assertEqual(title.wavePending, 0, "wavePending");
  assertEqual(title.speed, 1, "speed");
  assertNull(title.selected, "selected");
  assertNull(title.hoverShop, "hoverShop");
  assertNull(title.build, "build");
  assertEqual(title.simTime, 0, "simTime");
  assertLength(title.towers, 0, "the tower roster is emptied");
  assertLength(title.surge, 0, "the surge roster is emptied");
  assertEqual(title.waveSpawning, true, "the world gate is turned back on");

  // The one field the specification names as untouched.
  assertEqual(
    title.muted,
    true,
    "muted is left exactly as it stands: the runtime owns muting",
  );

  await h.advance(1);
  captureStill(h, "title");
});
