// Spectra — screens/challenge-perfect-result: a perfect challenge stage says so.
//
// THE RULE. `specs/ui.md`, on what `stageCleared` reports: after "A challenge stage in
// which every drone was destroyed" it draws `PERFECT_TEXT` (`PERFECT!`).
// `specs/stages.md` fixes what "every" means — `CHALLENGE_TOTAL` (`40`) drones, in
// `CHALLENGE_GROUPS` (`5`) groups of `CHALLENGE_PER_GROUP` (`8`) — and
// `specs/scoring.md` pays `SCORE_PERFECT_BONUS` for it.
//
// WHY THIS ONE IS PLAYED RATHER THAN POSED. The count of a challenge stage's drones
// destroyed is a latch the run keeps, and `specs/instrumentation.md` gives the surface
// no operation that sets it — `reset` returns it to its opening value and nothing else
// touches it. So there is no pose that reaches "every drone was destroyed": the stage
// has to be flown and its forty drones really destroyed. The game replays to a known
// outcome without a player being implemented, which is what an integration check is
// for.
//
// HOW THEY ARE DESTROYED. By the discharge, and it is the only instrument that could
// do it. `specs/resonance.md` makes the wave "band-blind" — "what band the ship holds,
// and what band a thing carries, change nothing about what it takes" — so it takes both
// of a flyover's alternating bands, and it destroys "a drone in phase `entering`,
// `diving`, or `returning`", which is exactly the phase `specs/stages.md` holds every
// challenge drone in "for the whole flyover". Forty aimed shots at drones sweeping
// across the field on a path of the build's own design would be a player; a wave that
// grows to `DISCHARGE_MAX_R` (`1500`), further than the stage's own diagonal, is not.
//
// THE CADENCE. One discharge every `DISCHARGE_TIME` (`0.5`) seconds, from the moment
// the wave opens: the meter is posed to `RESONANCE_MAX` — `setResonance` is what
// `specs/instrumentation.md` provides, and `specs/resonance.md` makes a discharge
// available exactly there — and the discharge action is driven on its real key.
// `specs/stages.md` releases a group every `ENTER_GROUP_GAP` (`0.6`) seconds, so every
// group is inside a wave within a fraction of a second of arriving, long before any of
// them could sweep off the field.
//
// THE PRECONDITION, AND WHAT IT COSTS. That the drive really did destroy all forty is
// read off the score: `specs/scoring.md` pays `SCORE_CHALLENGE_DRONE` (`100`) for each,
// so a run that took every one of them has been paid at least
// `CHALLENGE_TOTAL * SCORE_CHALLENGE_DRONE`. It is the only reading of "how many did
// this drive destroy" the surface offers, and it does mean a build whose challenge
// scoring is broken fails here as well as in the `scoring` group. The alternative —
// asserting `PERFECT!` without knowing whether the scenario earned it — would grade a
// build for a screen it was right not to draw.
//
// WHAT IS NOT ASSERTED. What the screen reports when a drone SURVIVED, which is
// `screens/challenge-hit-count`'s; how long the screen holds, which is
// `screens/stage-cleared-hold`'s; the bonus itself, which is the `scoring` group's.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_TOTAL,
  DISCHARGE_TIME,
  PERFECT_TEXT,
  RESONANCE_MAX,
  SCORE_CHALLENGE_DRONE,
  isChallengeStage,
} from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewText,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage flown: the first challenge stage (specs/stages.md). */
const CHALLENGE_STAGE = 3;

/** The key `specs/controls.md` binds `discharge` to, written out as it states it. */
const DISCHARGE_KEY = "KeyX";

/**
 * The frames one discharge cycle runs after the key is pressed.
 *
 * The wave's whole life, `DISCHARGE_TIME` (`0.5`) seconds (`specs/resonance.md`), plus
 * two frames so the next press lands after it has stopped rather than on top of it —
 * the specification says nothing about a discharge released while a wave is live, and
 * the scenario has no need to find out.
 */
const CYCLE_FRAMES = ticksFor(DISCHARGE_TIME) + 2;

/**
 * The most cycles the flyover is given, and how long the interstitial is waited for
 * afterwards.
 *
 * `specs/stages.md` releases the last of the five groups `2.4` seconds in, and each
 * cycle covers a little over half a second, so a flyover cleared as it arrives is over
 * inside a dozen; `40` is room for a build whose groups take longer to reach the
 * field. Both are bounds on the scenario rather than thresholds on the build.
 */
const MAX_CYCLES = 40;
const MAX_SETTLE_FRAMES = ticksFor(15);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws PERFECT! after a challenge stage in which every drone was destroyed", async () => {
  await startStage(h, CHALLENGE_STAGE);
  const opened = h.snapshot();
  assertEqual(opened.screen, "inWave", "the stage's live wave is open");
  assertEqual(
    opened.isChallenge,
    isChallengeStage(CHALLENGE_STAGE),
    `stage ${String(CHALLENGE_STAGE)} is a challenge stage (specs/stages.md)`,
  );

  // A discharge every DISCHARGE_TIME, from the moment the wave opens, for as long as
  // the stage is still being played.
  for (let cycle = 0; cycle < MAX_CYCLES; cycle += 1) {
    if (h.snapshot().screen !== "inWave") break;
    h.debug.setResonance(RESONANCE_MAX);
    await h.tap(DISCHARGE_KEY);
    await h.advance(CYCLE_FRAMES);
  }

  const finished = await h.until((s) => s.screen === "stageCleared", {
    maxFrames: MAX_SETTLE_FRAMES,
    poll: 1,
  });
  assertTrue(
    finished.hit,
    "the challenge stage finishing and opening the stage-cleared interstitial " +
      "— the stage ends when the last of its drones has left the field or been " +
      "destroyed (specs/stages.md); the game was on " +
      `${finished.snapshot.screen} with ` +
      `${String(finished.snapshot.drones.length)} drones still on the field`,
  );

  const cleared = h.snapshot();
  assertGreaterThanOrEqual(
    cleared.score,
    CHALLENGE_TOTAL * SCORE_CHALLENGE_DRONE,
    "precondition: the score covers all CHALLENGE_TOTAL " +
      `(${String(CHALLENGE_TOTAL)}) of the stage's drones at ` +
      `SCORE_CHALLENGE_DRONE (${String(SCORE_CHALLENGE_DRONE)}) each ` +
      "(specs/scoring.md), so the discharges really did destroy every one of them",
  );

  const calls = await drawFrame(h);
  captureStill(h, "perfect");

  assertTrue(
    drewText(calls, PERFECT_TEXT),
    `the stage-cleared screen drawing PERFECT_TEXT (${PERFECT_TEXT}) after a ` +
      "challenge stage in which every drone was destroyed (specs/ui.md)",
  );
});
