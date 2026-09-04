// Floe — instrumentation/state-run: the run's own state — the screen, the phase
// and its hold, the menu's highlight, the score, the lives, the level, the level
// reached and the crossing timer — is reported and reads back.
//
// `specs/instrumentation.md` states the rule the whole surface is built to:
// "`snapshot` returns exactly this object. Every field an operation can set is
// present, so every operation is verifiable by setting it and reading it back."
// The rest of this suite reads its verdicts out of that object, so a field that
// is absent, that answers with something of the wrong kind, or that fails to
// report what a pose put into it costs the point that asks for it somewhere
// else, under a heading about a mechanic. This family of the shape is named
// here instead.
//
// THE SHAPE AND THE READ-BACK ARE ONE CLAIM PER FAMILY, and the families are
// separate points. A build whose bears report nothing usable must grade
// differently from one whose whole snapshot is wrong, and a single point over
// the whole surface can only fail once — so the six `instrumentation/state-*`
// points divide the object along the lines `specs/instrumentation.md` itself
// draws.
//
// EVERY POSE IS READ BEFORE ANYTHING RUNS. The harness holds the game off its own
// clock, so nothing happens between a pose and the snapshot that checks it: one
// tick would run the hold, the cooldown and the lanes on, and the check would be
// reading the update rather than the pose.
//
// EVERY VALUE IS ONE THE POSE HAD TO CARRY. Each is deliberately not the value
// `startCrossing` left behind, so a build that ignores a pose reads back the
// value it already held rather than the one asked for, and the failure names the
// operation. Each boolean is posed BOTH WAYS for the same reason: a field read
// back once could be a constant.
//
// WHAT THIS DOES NOT DECIDE. What any posed value MEANS to the simulation. That a
// posed gate holds a faculty off is each gate item's, that a posed step is
// carried out is `hunter/*`'s, and that a lane at a speed carries its items that
// far is `ice/*`'s and `water/*`'s.
//
// `version`, `timerMax`, `muted` and `simTime` are read for their PRESENCE and
// their kind alone, and that is not an omission. No operation sets any of them:
// `version` is the constant the surface carries, `timerMax` is derived from the
// level, `muted` is the runtime's own bit reached through the mute action, and
// `simTime` accumulates on every tick. What each of them MEANS is graded where
// it is used — `controls/mute-m`, `progression/timer-length-level-1`,
// `instrumentation/tick-length` — so this point reads that they are there.
//
// `setLevel` IS TAKEN LAST, ON PURPOSE. It lays the strait out for the level,
// replacing every vehicle and every floe, so posing it earlier would empty the
// rosters other points read.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { FLOE_DEBUG_VERSION, type Phase, type Screen } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The strait the per-entity poses below are applied to. */
/**
 * The values posed into the scalar fields.
 *
 * Every one is exactly representable as a double, so each reading is an exact
 * comparison rather than one carrying a tolerance the specification never
 * granted: a pose is a pose, and a build that stored the number it was handed
 * reports that number.
 */
const SCREEN: Screen = "howto";
const PHASE: Phase = "dying";
const PHASE_TIMER = 0.75;
const MENU_INDEX = 2;
const SCORE = 4321;
const LIVES = 5;
const REACHED_LEVEL = 6;
const TIMER = 12.5;
const LEVEL = 7;

/** The six screens and the three phases, as `specs/instrumentation.md` lists them. */
const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "victory",
  "gameover",
];
const PHASES: readonly Phase[] = ["crossing", "dying", "clearing"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the run's own fields and reads every pose of them back", async () => {
  await startCrossing(h);

  await h.advance(1);
  // Taken before the walk, so a pose that fails to land still leaves the picture
  // of the run it was applied to.
  await captureStill(h, "read-back");

  const s = await h.snapshot();

  /** Apply one pose and read its own field straight back off the snapshot. */
  const readsBack = async <T>(
    pose: () => Promise<void>,
    read: (s: FloeSnapshot) => T,
    want: T,
    what: string,
  ): Promise<void> => {
    await pose();
    assertEqual(read(await h.snapshot()), want, what);
  };

  // ---- The fields the run reports ---------------------------------------

  assertEqual(s.version, FLOE_DEBUG_VERSION, "snapshot().version");
  assertContains(SCREENS, s.screen, "snapshot().screen");
  assertContains(PHASES, s.phase, "snapshot().phase");
  assertEqual(typeof s.phaseTimer, "number", "snapshot().phaseTimer");
  assertEqual(typeof s.menuIndex, "number", "snapshot().menuIndex");
  assertEqual(typeof s.level, "number", "snapshot().level");
  assertEqual(typeof s.reachedLevel, "number", "snapshot().reachedLevel");
  assertEqual(typeof s.lives, "number", "snapshot().lives");
  assertEqual(typeof s.score, "number", "snapshot().score");
  assertEqual(typeof s.timer, "number", "snapshot().timer");
  assertEqual(
    typeof s.timerMax,
    "number",
    "snapshot().timerMax, derived from the level (specs/progression.md)",
  );
  assertEqual(typeof s.muted, "boolean", "snapshot().muted");
  assertEqual(typeof s.simTime, "number", "snapshot().simTime");

  // ---- What each pose reads back ----------------------------------------

  await readsBack(
    () => h.debug.setScreen(SCREEN),
    (s) => s.screen,
    SCREEN,
    `snapshot().screen after setScreen(${JSON.stringify(SCREEN)})`,
  );
  await readsBack(
    () => h.debug.setPhase(PHASE),
    (s) => s.phase,
    PHASE,
    `snapshot().phase after setPhase(${JSON.stringify(PHASE)})`,
  );
  await readsBack(
    () => h.debug.setPhaseTimer(PHASE_TIMER),
    (s) => s.phaseTimer,
    PHASE_TIMER,
    `snapshot().phaseTimer after setPhaseTimer(${PHASE_TIMER})`,
  );
  await readsBack(
    () => h.debug.setMenuIndex(MENU_INDEX),
    (s) => s.menuIndex,
    MENU_INDEX,
    `snapshot().menuIndex after setMenuIndex(${MENU_INDEX})`,
  );
  await readsBack(
    () => h.debug.setScore(SCORE),
    (s) => s.score,
    SCORE,
    `snapshot().score after setScore(${SCORE})`,
  );
  await readsBack(
    () => h.debug.setLives(LIVES),
    (s) => s.lives,
    LIVES,
    `snapshot().lives after setLives(${LIVES})`,
  );
  await readsBack(
    () => h.debug.setReachedLevel(REACHED_LEVEL),
    (s) => s.reachedLevel,
    REACHED_LEVEL,
    `snapshot().reachedLevel after setReachedLevel(${REACHED_LEVEL})`,
  );
  await readsBack(
    () => h.debug.setTimer(TIMER),
    (s) => s.timer,
    TIMER,
    `snapshot().timer after setTimer(${TIMER})`,
  );

  // ---- The level, taken last because it re-lays the sixteen lanes -------

  await readsBack(
    () => h.debug.setLevel(LEVEL),
    (s) => s.level,
    LEVEL,
    `snapshot().level after setLevel(${LEVEL})`,
  );
});
