// Meltdown — instrumentation/reset-restores-title: `reset` puts every declared
// field back to the value the specification lists, and leaves muting alone.
//
// THE RULE. `specs/instrumentation.md` lists what `reset` restores, field by
// field: `screen` to `"title"`, `phase` to `"opening"`, `menuIndex` to `0`,
// `mode` to `"containment"`, `difficulty` to `"medium"`, `money` to the starting
// money that pair gives, `lives` to its starting lives, `score` to `0`, `wave` to
// `1`, `buildTimer` to `0`, `wavePending` to `0`, `speed` to `1`, `selected`,
// `hoverShop` and `build` to `null`, and `simTime` to `0`; it empties the two
// rosters and turns `waveSpawning` back on. `muted` "is left exactly as it
// stands, because muting is a player preference the runtime owns".
//
// WHY IT IS DECIDED HERE. Every suite in this project opens on a `reset`, and
// several of them open on nothing else: a build whose `reset` restores twelve of
// the sixteen fields hands every one of those suites a run it did not pose, and
// the grade would blame whichever item read the leftover. So the reset is taken
// against a run posed to differ on EVERY declared field at once — a different
// screen, phase, menu row, mode, difficulty, money, lives, score, wave, timer,
// pending count and speed, a selection, a hover, a held preview, towers, units,
// a shut world gate, and a simulated clock that has run.
//
// THE STARTING MONEY AND LIVES ARE THE SPECIFICATION'S. They are computed here
// from `specs/modes.md`'s own table for the Containment Medium pair `reset`
// returns to, never read back off the build's `startMoney` and `startLives` —
// a build with those two derived figures wrong would otherwise be graded against
// its own mistake, and `modes/containment-medium` is the item that decides them.
//
// MUTING IS THE ONE FIELD THAT MUST NOT MOVE, and it is checked in BOTH
// directions on the one harness: the bit a page loads with survives a reset, and
// so does the bit the mute binding leaves after it. One direction alone would
// pass a build that pinned the bit either way. Neither leg asserts WHICH bit
// either state is — the specification fixes no starting value and whether the
// binding toggles is `controls/mute-key`'s item — only that a reset carries
// whatever it found through unchanged. There is no `setMuted` on the surface, so
// the mute is reached the way a player reaches it, through the `KeyM` binding
// (`specs/controls.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { DEFAULT_SEED, modeFigures } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesFor,
  poseTower,
  poseWalker,
  startRun,
  tapAction,
  type Harness,
} from "../harness";

/** The pair `reset` returns to, and the two figures `specs/modes.md` gives it. */
const TITLE_FIGURES = modeFigures("containment", "medium");

/**
 * The value `buildTimer`, `wavePending` and `simTime` come back to.
 *
 * Compared for exact equality rather than with a tolerance, and that is not a
 * strictness this check invented: `specs/instrumentation.md` has `reset` WRITE
 * each of the three, so a conformant build stores a literal `0` and nothing is
 * integrated for a float to drift over.
 */
const RESTORED_ZERO = 0;

/** Game time run before the reset, so `simTime` has something to restore FROM. */
const RUN_SECONDS = 1;

let h: Harness;

/**
 * Pose a run that differs from the title on every declared field at once.
 *
 * Nothing here is a threshold: each value is simply not the one `reset` must
 * come back to, so a field left untouched by a broken `reset` reads as the value
 * this function put there.
 */
async function poseADivergentRun(): Promise<void> {
  const { debug } = h;
  await startRun(h, "bottleneck", "hard");
  await debug.setScreen("gameover");
  await debug.setPhase("wave");
  await debug.setMenuIndex(2);
  await debug.setMoney(9137);
  await debug.setLives(3);
  await debug.setScore(6821);
  await debug.setWave(11);
  await debug.setBuildTimer(8.5);
  await debug.setWavePending(17);
  await debug.setSpeed(2);
  await debug.setWaveSpawning(false);

  const site = freeSite(0);
  const tower = await poseTower(h, "lance", site.col, site.row);
  await poseWalker(h, "hulk", "left");
  await debug.setSelected(tower);
  await debug.setHoverShop("rime");
  await debug.setArmed("flak");

  // And a clock that has run, so `simTime` is restored from something.
  await h.advance(framesFor(RUN_SECONDS));
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores every declared field to its title value", async () => {
  await poseADivergentRun();

  const posed = await h.snapshot();
  assertGreaterThan(
    posed.simTime,
    0,
    "the simulated clock had run before the reset",
  );

  await h.debug.reset();
  // Read BEFORE a frame runs. `simTime` accumulates the game time the simulation
  // advanced by (`specs/instrumentation.md`), so a frame driven for the picture
  // would put one frame's worth back on the very field being read.
  const s = await h.snapshot();
  // And then the frame that draws the title screen the reset returned to.
  await h.advance(1);
  await captureStill(h, "title");

  assertEqual(s.screen, "title", "reset restores screen");
  assertEqual(s.phase, "opening", "reset restores phase");
  assertEqual(s.menuIndex, 0, "reset restores menuIndex");
  assertEqual(s.mode, "containment", "reset restores mode");
  assertEqual(s.difficulty, "medium", "reset restores difficulty");
  assertEqual(
    s.money,
    TITLE_FIGURES.startMoney,
    "reset restores money to Containment Medium's starting money",
  );
  assertEqual(
    s.lives,
    TITLE_FIGURES.startLives,
    "reset restores lives to Containment Medium's starting lives",
  );
  assertEqual(s.score, 0, "reset restores score");
  assertEqual(s.wave, 1, "reset restores wave");
  assertEqual(s.buildTimer, RESTORED_ZERO, "reset restores buildTimer");
  assertEqual(s.wavePending, RESTORED_ZERO, "reset restores wavePending");
  assertEqual(s.speed, 1, "reset restores speed");
  assertEqual(s.selected, null, "reset clears the selection");
  assertEqual(s.hoverShop, null, "reset clears the shop hover");
  assertEqual(s.build, null, "reset clears the held preview");
  assertEqual(s.simTime, RESTORED_ZERO, "reset restores simTime");
  assertLength(s.towers, 0, "reset empties the tower roster");
  assertLength(s.surge, 0, "reset empties the surge roster");
  assertEqual(s.waveSpawning, true, "reset turns the world gate back on");
});

it("leaves muting exactly as it stands, both ways", async () => {
  // The bit the page loaded with, whichever it is.
  const loaded = (await h.snapshot()).muted;
  await poseADivergentRun();
  await h.debug.reset();
  assertEqual(
    (await h.snapshot()).muted,
    loaded,
    `reset leaves the mute bit the page loaded with (${String(loaded)})`,
  );

  // And the bit the mute binding leaves behind, reached the way a player reaches
  // it. What that press did to the bit is not asserted here; whatever it left is
  // what the reset must carry through.
  await tapAction(h, "mute");
  const pressed = (await h.snapshot()).muted;
  await poseADivergentRun();
  await h.debug.reset(DEFAULT_SEED);
  assertEqual(
    (await h.snapshot()).muted,
    pressed,
    `reset leaves the mute bit the binding left (${String(pressed)})`,
  );
});
