// audio/stage-clear — the cue a cleared stage plays.
//
// `specs/ui.md` fixes `stage-clear` as the cue played when "a stage clears", and
// governs all nine with one sentence: "Each is played on the frame its event
// happens and at most once on that frame."
//
// WHY THIS ONE IS PLAYED OUT RATHER THAN POSED, AND ON A CHALLENGE STAGE. Under
// this engine a cue's NAME is unobservable (see `./cues.ts`), so a frame that
// raises two cues cannot be read as raising either one in particular — and
// `specs/ui.md` is explicit that "a frame that raises more than one of them plays
// each of those once". A STANDARD stage clears "in the moment the last drone of
// its wave is destroyed" (`specs/stages.md`), so its clearing frame is also a
// kill frame, and a build that played only the kill cue there would be
// indistinguishable from one that played both.
//
// A challenge stage has an ending that raises nothing else. `specs/stages.md`:
// "The stage ends in the moment the last of its drones has left the field or been
// destroyed. It then opens the stage-cleared interstitial." A flyover carries no
// firing drone and no enemy bullet, its drones are not shot at here, and one that
// leaves the field is simply removed — no kill, no cue. So the whole flyover is
// silent and the frame the stage-cleared interstitial opens is the clearing frame
// with nothing else on it.
//
// NOTHING IS POSED AWAY. The stage the GAME builds is opened with `startStage`
// and then left alone: no drone is removed, no gate is shut, and no key is
// pressed. That matters because `specs/stages.md` leaves a build free to read
// "its wave" either as the drones the stage built or as the drones on the field,
// and a scenario that cleared the field by hand would be asking one of those two
// readings for a clear the other would never give. A flyover run to its own end
// clears under both.
//
// THE RELEASE IS SKIPPED, EVERYTHING AFTER IT IS STEPPED. `specs/swarm.md`
// releases group `k` at `k * ENTER_GROUP_GAP`, and `specs/stages.md` gives a
// challenge stage `CHALLENGE_GROUPS` (`5`) of them, each leaving "within eight
// seconds of the group's release". So the stage cannot possibly end before the
// last group is released, and the skip stops there — a FIXED span, not a
// condition read off the field. Skipping any further would be guesswork: a group
// crosses and leaves as a block, so the drone count can fall from a whole group
// to none inside a frame or two, and a skip that waited for "one drone left"
// would sail past the clearing frame on a build whose groups exit together.
// Sounds emitted inside a `skip` are attributed to the frame the skip ended on,
// which is the other reason the skip stops before anything worth reading.
//
// WHAT THIS DOES NOT DECIDE. When a stage clears, or what the interstitial
// reports, which are `stages/*`'s and `screens/stage-cleared-*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  CHALLENGE_EVERY,
  CHALLENGE_GROUPS,
  ENTER_GROUP_GAP,
} from "../constants";
import {
  TICK_HZ,
  captureStill,
  createHarness,
  framesFor,
  startStage,
  type Harness,
} from "../harness";
import {
  quietFrames,
  soundsBeforeEvent,
  soundsOnEvent,
  watchForEvent,
} from "./cues";

/** The first challenge stage: `isChallengeStage(stage)` is `stage % 3 === 0`. */
const CHALLENGE_STAGE = CHALLENGE_EVERY;

/**
 * Seconds of game time skipped off camera: the wave's whole release.
 *
 * `specs/swarm.md` releases group `k` when the wave's entry clock reaches
 * `k * ENTER_GROUP_GAP`, so the last of `CHALLENGE_GROUPS` (`5`) groups is
 * released at `(CHALLENGE_GROUPS - 1) * ENTER_GROUP_GAP` (`2.4` s), and a stage
 * whose last group has not been released cannot yet have ended. A twentieth of a
 * second past that is therefore a span the clearing frame is certainly still
 * ahead of, whatever the build's flyover looks like.
 */
const RELEASE_SPAN = (CHALLENGE_GROUPS - 1) * ENTER_GROUP_GAP + 0.05;

/** Seconds `specs/stages.md` gives a group to cross the field and leave it. */
const FLYOVER_SECONDS = 8;

/**
 * Frames the rest of the flyover is given, stepped one at a time.
 *
 * The last group is released by `RELEASE_SPAN` and leaves within
 * `FLYOVER_SECONDS` of its release, so the clearing frame lands inside
 * `FLYOVER_SECONDS` of where the skip stopped. A fifth of a second of slack
 * covers the frame the wave opened on, which the release span is measured from.
 */
const ENDING_FRAMES = framesFor(FLYOVER_SECONDS + 0.2);

/** Frames run after the reading, purely so the still shows the interstitial. */
const TAIL_FRAMES = framesFor(0.2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame a stage clears, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its whole
  // audio layer and is entitled to open it on the player's first interaction
  // alone (`specs/ui.md`). The key is bound to nothing, so this changes no state.
  await h.armAudio();
  // The wave the GAME builds for its first challenge stage, opened by running its
  // stage intro out. Nothing about it is posed from here on.
  await startStage(h, CHALLENGE_STAGE);
  const opened = await h.snapshot();
  assertEqual(
    opened.isChallenge,
    true,
    `stage ${String(CHALLENGE_STAGE)} is a challenge stage, ` +
      `isChallengeStage(stage) being stage % ${String(CHALLENGE_EVERY)} === 0 ` +
      "(specs/stages.md)",
  );

  // The wave's release, off camera: no frame boundary is opened, so nothing here
  // can be attributed to a frame the watch below reads. It stops the moment the
  // last group is certainly out, which is the earliest point the stage could
  // possibly end — everything the check is about is still ahead.
  await h.skip(RELEASE_SPAN, TICK_HZ);
  const released = await h.snapshot();
  assertEqual(
    released.screen,
    "inWave",
    `the flyover was still being played ${String(RELEASE_SPAN)} s in, its last ` +
      `of ${String(CHALLENGE_GROUPS)} groups having only just been released, so ` +
      "the clearing frame is still ahead of the reading (specs/swarm.md, " +
      "specs/stages.md)",
  );

  const watch = await watchForEvent(
    h,
    (s) => s.screen === "stageCleared",
    ENDING_FRAMES,
  );
  // Held on past the reading, so the still shows the interstitial rather than the
  // frame it opened on. Nothing after this line can reach an assertion.
  await h.advance(TAIL_FRAMES);
  await captureStill(h, "clear");

  assertEqual(
    watch.hit,
    true,
    "the challenge stage opened its stage-cleared interstitial inside the " +
      `${String(ENDING_FRAMES)} frames its last drone is given to leave the ` +
      "field (specs/stages.md)",
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over the ${String(quietFrames(watch))} frames the ` +
      "flyover's last drone crossed, a stretch in which no drone fires, no " +
      "bullet is in flight and nothing is destroyed — a cue is played on the " +
      "frame its event happens (specs/ui.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the frame the stage cleared and its " +
      "interstitial opened, which is the frame the stage-clear cue is played on " +
      "(specs/ui.md)",
  );
});
