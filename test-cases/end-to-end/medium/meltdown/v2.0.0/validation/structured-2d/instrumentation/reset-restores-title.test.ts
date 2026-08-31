// Meltdown — instrumentation/reset-restores-title: `reset` returns the game to
// its title values.
//
// `specs/instrumentation.md` lists them outright: "`reset` restores `screen` to
// `"title"`, `phase` to `"opening"`, `menuIndex` to `0`, `mode` to
// `"containment"`, `difficulty` to `"medium"`, `money` to the starting money that
// pair gives, `lives` to its starting lives, `score` to `0`, `wave` to `1`,
// `buildTimer` to `0`, `wavePending` to `0`, `speed` to `1`, `selected` to
// `null`, `hoverShop` to `null`, `build` to `null`, and `simTime` to `0`. It
// empties the tower and surge rosters, clears the spawner's clock, and turns the
// world gate `waveSpawning` back on." And one exception: "`muted` is left exactly
// as it stands, because muting is a player preference the runtime owns".
//
// EVERY FIELD IS POSED AWAY FROM ITS TITLE VALUE FIRST. A `reset` that restored
// nothing would pass a check run on a game that was already at its title values,
// so the run below is driven to a state that shares no field with the title:
// another screen, another phase, another mode and difficulty, a purse, a score, a
// wave deep in the run, a running build timer, a doubled speed, towers on the
// floor, units walking, a selection, a hover, a held preview, the world gate
// off, and — through frames actually advanced — a `simTime` that has accumulated.
//
// THE MUTE IS REACHED THE WAY A PLAYER REACHES IT, through the `mute` binding
// `specs/controls.md` fixes, because there is no `setMuted` to pose it with. That
// it is ON before the reset is asserted as this check's precondition: a reading
// taken with the bit already off would say nothing about whether `reset` cleared
// it.
//
// THE SPAWNER'S CLOCK is not a snapshot field, so what is read for it is the
// consequence the specification gives it: with the gate back on and a wave posed
// after the reset, a released unit is one the wave's own cadence released rather
// than one a half-finished clock let out early. That belongs to `surge/` — what
// is read here is the gate itself, which `reset` "turns back on".

import { afterEach, beforeEach, it } from "vitest";
import {
  DIFFICULTY_TABLE,
  MODE_TABLE,
  BUILD_PHASE_TIME,
} from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  tileCenter,
  type Harness,
} from "../harness";
import { quietSite } from "./ground";

/** The money and lives Containment at Medium gives, from `specs/modes.md`'s table. */
const TITLE_MONEY =
  MODE_TABLE.containment.startMoney ?? DIFFICULTY_TABLE.medium.money;
const TITLE_LIVES = MODE_TABLE.containment.startLives;

/** The figures the run is posed to, none of them a title value. */
const POSED_MONEY = 4321;
const POSED_LIVES = 17;
const POSED_SCORE = 987_654;
const POSED_WAVE = 13;
const POSED_MENU_INDEX = 2;
const POSED_PENDING = 42;

/** Frames advanced before the reset, so `simTime` has something to restore from. */
const FRAMES_BEFORE = 30;

/**
 * How far the restored `simTime` may sit from `0`, in seconds.
 *
 * `reset` restores it to `0` and no frame is advanced between the call and the
 * reading, so the only figure a conformant build can report is `0` itself; the
 * allowance is for a build that stores it as a float and nothing else.
 */
const SIM_TIME_TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores every declared field to its title value and leaves muted alone", async () => {
  // The mute bit, reached the only way there is: the player's own binding.
  await tapAction(h, "mute");
  await h.advance(1);
  assertEqual(
    h.snapshot().muted,
    true,
    "precondition: the mute binding turned the runtime's mute bit on",
  );

  // A run posed as far from the title screen as the surface reaches.
  startRun(h, "bottleneck");
  h.debug.setDifficulty("hard");
  h.debug.setPhase("wave");
  h.debug.setMenuIndex(POSED_MENU_INDEX);
  h.debug.setMoney(POSED_MONEY);
  h.debug.setLives(POSED_LIVES);
  h.debug.setScore(POSED_SCORE);
  h.debug.setWave(POSED_WAVE);
  h.debug.setBuildTimer(BUILD_PHASE_TIME);
  h.debug.setWavePending(POSED_PENDING);
  h.debug.setSpeed(2);
  h.debug.setWaveSpawning(false);

  const site = quietSite(0);
  h.debug.addTower("arc", site.col, site.row, 0);
  const towerId = h.snapshot().towers[0].id;
  h.debug.addUnit("mote", "left");
  const unitId = h.snapshot().surge[0].id;
  const at = tileCenter(quietSite(8).col, quietSite(8).row);
  h.debug.setUnitPosition(unitId, at.x, at.y);
  h.debug.setSelected(towerId);
  h.debug.setHoverShop("lance");
  h.debug.setArmed("bloom");
  h.debug.setPreview(20, 20);

  // The frames are run while the run is on its `playing` screen, because
  // `specs/waves.md` holds the simulation still while the game is paused — and
  // the screen is only then posed to `paused`, so what `reset` is asked to
  // restore is a run that both accumulated time AND sits on another screen.
  await h.advance(FRAMES_BEFORE);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertGreaterThan(
    before.simTime,
    0,
    "precondition: the simulation had accumulated time to restore from",
  );
  assertLength(before.towers, 1, "precondition: a tower stood on the floor");
  assertLength(before.surge, 1, "precondition: a unit stood on the floor");

  h.debug.reset();
  const title = h.snapshot();
  captureStill(h, "title");

  assertEqual(title.screen, "title", "screen");
  assertEqual(title.phase, "opening", "phase");
  assertEqual(title.menuIndex, 0, "menuIndex");
  assertEqual(title.mode, "containment", "mode");
  assertEqual(title.difficulty, "medium", "difficulty");
  assertEqual(title.money, TITLE_MONEY, "money: Containment at Medium's start");
  assertEqual(title.lives, TITLE_LIVES, "lives: Containment's start");
  assertEqual(title.score, 0, "score");
  assertEqual(title.wave, 1, "wave");
  assertEqual(title.buildTimer, 0, "buildTimer");
  assertEqual(title.wavePending, 0, "wavePending");
  assertEqual(title.speed, 1, "speed");
  assertNull(title.selected, "selected");
  assertNull(title.hoverShop, "hoverShop");
  assertNull(title.build, "build");
  assertLength(title.towers, 0, "the tower roster");
  assertLength(title.surge, 0, "the surge roster");
  assertEqual(title.waveSpawning, true, "waveSpawning, turned back on");
  assertEqual(
    Math.abs(title.simTime) < SIM_TIME_TOLERANCE,
    true,
    "simTime, restored to 0",
  );

  // The one field it must not reach.
  assertEqual(title.muted, true, "muted, which reset leaves exactly as it was");
});
