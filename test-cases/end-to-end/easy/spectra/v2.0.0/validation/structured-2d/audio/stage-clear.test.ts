// audio/stage-clear — the cue a cleared stage plays.
//
// `specs/ui.md` fixes `CUES.stageClear` (`"stage-clear"`) as the cue played when
// "a stage clears", and governs all nine with one sentence: "Each is played on the
// frame its event happens and at most once on that frame."
//
// NOTHING IS POSED AWAY, AND THAT IS THE WHOLE DESIGN OF THIS ONE. `specs/stages.md`
// clears a stage when "the last drone of its wave is destroyed", and the wave is
// built as the stage-intro hold gives way. It leaves a build free to read "its
// wave" either as the drones the stage BUILT or as the drones ON THE FIELD, and a
// scenario that emptied the field by hand would be asking one of those two
// readings for a clear the other would never give — a validator that graded the
// reading rather than the cue. So the stage the GAME builds is opened with
// `startStage` and then left entirely alone: no drone is posed or removed, no gate
// is touched, and no key is pressed. A stage run to its own end clears under both
// readings.
//
// AND IT IS A CHALLENGE STAGE, because a challenge stage has an ending that is
// nothing but the ending. `specs/stages.md`: "No drone fires. No enemy bullet
// appears anywhere in a challenge stage", "A challenge drone's body costs no life",
// and "The stage ends in the moment the last of its drones has left the field or
// been destroyed". Nothing is shot at here, so nothing is destroyed and no drone is
// hit — the whole flyover raises no event at all, and the frame the interstitial
// opens on is the clearing frame with nothing else on it. A STANDARD stage would
// clear on the frame its last drone is destroyed, which is a kill frame too, so
// reading a standard clear would mean reading the quiet across a stretch in which
// the ship had to be firing.
//
// THE WHOLE STAGE IS STEPPED, ONE FRAME AT A TIME, from the frame the wave opens.
// The engine's bus announces a play synchronously, so a batched advance would reach
// the clear without saying which frame inside it anything sounded on; stepping the
// stage out means the "not before" reading covers every frame of the flyover rather
// than a window chosen after the fact.
//
// WHAT THIS DOES NOT DECIDE. When a stage clears, what the interstitial reports, or
// what the clear pays, which are `stages/*`'s, `screens/stage-cleared-*`'s and
// `scoring/stage-clear`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_EVERY,
  CHALLENGE_GROUPS,
  CUES,
  ENTER_GROUP_GAP,
} from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";
import {
  cuesBeforeEvent,
  cuesOnEvent,
  gainOnEvent,
  quietFrames,
  watchForEvent,
} from "./cues";

/** The first challenge stage: `isChallengeStage(stage)` is `stage % 3 === 0`. */
const CHALLENGE_STAGE = CHALLENGE_EVERY;

/**
 * Seconds the wave's whole release takes.
 *
 * `specs/swarm.md` releases group `k` when the wave's entry clock reaches
 * `k * ENTER_GROUP_GAP`, so the last of `CHALLENGE_GROUPS` (`5`) groups is released
 * at `(CHALLENGE_GROUPS - 1) * ENTER_GROUP_GAP` (`2.4` s).
 */
const RELEASE_SPAN = (CHALLENGE_GROUPS - 1) * ENTER_GROUP_GAP;

/** Seconds specs/stages.md gives a group to cross the field and leave it. */
const FLYOVER_SECONDS = 8;

/**
 * Frames the whole flyover is given to reach its end.
 *
 * The last group is released by `RELEASE_SPAN` and leaves "within eight seconds of
 * the group's release", so the clearing frame lands inside those two spans of the
 * frame the wave opened on — geometry from the specification's own figures, not a
 * tolerance. Half a second of slack covers the frame the wave opened on, which the
 * release span is measured from.
 */
const STAGE_FRAMES = ticksFor(RELEASE_SPAN + FLYOVER_SECONDS + 0.5);

/** Frames run after the reading, purely so the still shows the interstitial. */
const TAIL_FRAMES = ticksFor(0.2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.stageClear on the frame the stage clears, and not before", async () => {
  // The wave the GAME builds for its first challenge stage, opened by running its
  // stage intro out. Nothing about it is posed from here on.
  await startStage(h, CHALLENGE_STAGE);
  const opened = h.snapshot();
  assertEqual(
    opened.isChallenge,
    true,
    `stage ${String(CHALLENGE_STAGE)} is a challenge stage, ` +
      `isChallengeStage(stage) being stage % ${String(CHALLENGE_EVERY)} === 0 ` +
      "(specs/stages.md)",
  );
  assertEqual(
    opened.screen,
    "inWave",
    "the stage-intro hold gave way and the live wave opened, the hold being " +
      "posed to nothing before the frame that ran (specs/ui.md)",
  );

  const watch = await watchForEvent(
    h,
    (s) => s.screen === "stageCleared",
    STAGE_FRAMES,
  );
  // Held on past the reading, so the still shows the interstitial rather than the
  // frame it opened on. Nothing after this line can reach an assertion.
  await h.advance(TAIL_FRAMES);
  captureStill(h, "clear");

  assertEqual(
    watch.hit,
    true,
    "the challenge stage opened its stage-cleared interstitial inside the " +
      `${String(STAGE_FRAMES)} frames its ${String(CHALLENGE_GROUPS)} groups ` +
      "take to be released and to leave the field (specs/swarm.md, " +
      "specs/stages.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.stageClear),
    0,
    `times CUES.stageClear played over the ${String(quietFrames(watch))} frames ` +
      "the flyover crossed, a stretch in which no drone fires, no bullet is in " +
      "flight and nothing is destroyed — a cue is played on the frame its event " +
      "happens (specs/ui.md)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.stageClear),
    1,
    "times CUES.stageClear played on the frame the stage cleared and its " +
      "interstitial opened, which is its own frame and at most once on it " +
      "(specs/ui.md)",
  );
  assertGreaterThan(
    gainOnEvent(watch, CUES.stageClear),
    0,
    "the gain the bus announced the stage-clear cue at, nothing here having " +
      "muted it — each of the nine is a distinct short sound a player hears " +
      "(specs/ui.md)",
  );
});
