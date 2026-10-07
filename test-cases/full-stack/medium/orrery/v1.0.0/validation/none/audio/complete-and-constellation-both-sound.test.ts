// audio/complete-and-constellation-both-sound — the boundary that consumes the
// constellation which takes the last tally to target sounds BOTH cues.
//
// THE RULE. `specs/ui.md`'s cue table gives the two events one line each —
// "`constellation` | `CUES.constellation` | A set consumes one or more
// constellations" and "`complete` | `CUES.complete` | The run completes" — and
// both events happen at the same boundary here: "A set consumes an accepted
// constellation and its tally rises", then "After the rises, if every set's tally
// has reached the challenge's `target`, the run completes"
// (`specs/simulation.md`, Boundaries and Completion and metrics). Each cue is
// "played on the frame its event happens, from `update`, and at most once on that
// frame, however many of the event fired within it" (`specs/ui.md`) — so the
// completing boundary is one frame carrying two cues, not one cue standing in for
// both.
//
// THE THREE BOUNDARIES, AND WHY THERE ARE THREE. Under either engine the cue bus
// announces each cue by name and one boundary would settle this. Under no engine
// there is no bus: a sound is known to have sounded and its NAME is not
// observable, so "both sounded" has to be read as "MORE sounded here than where
// only one of the two events happened". So the same world is posed three times
// and the sounds each boundary emits are compared:
//
//   A. The tally posed AT the target with nothing on the set's footprint: the
//      boundary completes and consumes nothing. `complete` alone.
//   B. The tally one short with a `sol` on the footprint and the completion
//      switch held OFF: the boundary consumes and does not complete.
//      `constellation` alone.
//   C. The tally one short, the same `sol`, the switch left ON: the boundary
//      consumes AND completes. Both.
//
// AND WHAT IS COMPARED IS ONE FRAME'S SOUNDS, NOT A WINDOW'S. Each boundary is
// driven one frame at a time until the run crosses it, so the frame it fell on is
// known rather than inferred, and every count below is that frame's alone —
// "played on the frame its event happens, from `update`" (`specs/ui.md`). A
// window's total would count anything else the build did in the frames around it
// and blame this point for it.
//
// THE VERDICT. C's boundary frame sounds strictly more than A's and strictly more
// than B's — so neither cue is standing in for the other, whichever engine is
// reading — and under an engine, which names its cues, both `constellation` and
// `complete` sound on that frame, neither of them more than once.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { CONSTELLATION_TARGET, CUES } from "../constants";
import { setPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  openRun,
  openTitle,
  spawnMote,
  tallyOf,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";
import { TAIL_FRAMES, driveUntil, openSilence, soundsOn } from "./silence";

/** The whole machine: one set for the challenge's only product, at the origin. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/** What one posed boundary sounded. */
interface Boundary {
  /** Every sound the window collected, stamped with the frame it fell on. */
  played: TimedCue[];
  /** The frame the run crossed the boundary on, and `0` if it never did. */
  frame: number;
  /** How many sounds fell on that frame. */
  sounds: number;
  /** The run's status once the boundary had passed. */
  status: string | undefined;
  /** The one product's tally once it had passed. */
  tally: number | null;
}

let h: Harness;

beforeEach(async () => {
  // ARMED AT CREATION, because this suite reads what the build SOUNDED and a
  // browser opens no audio context without a user gesture: unarmed, `openSilence`
  // below would find the page's silence rather than the build's. The press of
  // `INERT_KEY` goes in before the harness's opening `reset`, whose restore puts
  // back anything it touched, so it costs this check nothing — see `silence.ts`.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Pose one boundary on the same one-set world and hand back what it sounded.
 *
 * `tally` is what the product's tally is posed at before the cycle runs, `deliver`
 * whether a `sol` rests on the set's footprint waiting to be consumed, and
 * `completing` whether the completion switch is left on.
 */
async function boundary(
  tally: number,
  deliver: boolean,
  completing: boolean,
): Promise<Boundary> {
  await openRun(h, { challenge: BARE, machine: ONE_SET });
  if (!completing) await h.debug.setCompletion(false);
  await h.debug.setTally(0, tally);
  if (deliver) await spawnMote(h, ORIGIN, "sol");

  const played = watchCues(h);
  // One frame at a time to the boundary, so the frame it fell on is the frame
  // this reads. A boundary that COMPLETES holds the cycle counter where it stood,
  // so the predicate names either way of crossing it.
  const frame = await driveUntil(
    h,
    (snapshot) =>
      (snapshot.sim?.cycle ?? 0) >= 1 || snapshot.sim?.status === "complete",
  );
  await h.advance(TAIL_FRAMES);

  const after = await h.snapshot();
  // A COPY, because `watchCues` leaves its sink attached: the array itself goes
  // on filling as the later boundaries run, and what this answers is what THIS
  // boundary sounded.
  const heard = [...played];
  return {
    played: heard,
    frame,
    sounds: cuesOnFrame(heard, frame).length,
    status: after.sim?.status,
    tally: tallyOf(after, 0),
  };
}

it("sounds both the constellation cue and the complete cue on the one boundary", async () => {
  await openTitle(h);
  await openSilence(h);

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the bed is up before any window opens, so no sound of its own falls inside one",
  );

  const completing = await boundary(CONSTELLATION_TARGET, false, true);
  const consuming = await boundary(CONSTELLATION_TARGET - 1, true, false);
  const both = await captureReplay(h, "both", () =>
    boundary(CONSTELLATION_TARGET - 1, true, true),
  );

  // The three worlds are the worlds they were meant to be.
  assertEqual(
    completing.status,
    "complete",
    "A: the tally posed at the target completes the boundary, consuming nothing",
  );
  assertEqual(
    consuming.status,
    "running",
    "B: with the completion switch off the consuming boundary does not complete",
  );
  assertEqual(
    consuming.tally,
    CONSTELLATION_TARGET,
    "B: and the set did consume, taking its tally to the target",
  );
  assertEqual(
    both.status,
    "complete",
    "C: the consumption takes the last tally to target and the run completes",
  );
  assertEqual(
    both.tally,
    CONSTELLATION_TARGET,
    "C: on the tally the consumption raised",
  );

  // Each boundary was reached, so each count below is a count of a frame that
  // happened.
  assertGreaterThan(completing.frame, 0, "A: the boundary was crossed");
  assertGreaterThan(consuming.frame, 0, "B: the boundary was crossed");
  assertGreaterThan(both.frame, 0, "C: the boundary was crossed");

  // What the completing, consuming boundary's own frame sounded.
  assertGreaterThan(
    both.sounds,
    0,
    "the completing boundary sounds on the frame it fell on, as a cue played on the frame its event happens does",
  );
  assertGreaterThan(
    both.sounds,
    completing.sounds,
    "and more than a boundary that only completes: the constellation cue is there beside the complete cue",
  );
  assertGreaterThan(
    both.sounds,
    consuming.sounds,
    "and more than a boundary that only consumes: the complete cue is there beside the constellation cue",
  );

  // And under an engine, which announces a cue by name, the frame carries each of
  // the two, and neither of them twice.
  assertGreaterThan(
    soundsOn(both.played, CUES.constellation, both.frame),
    0,
    "CUES.constellation sounds on the boundary frame",
  );
  assertGreaterThan(
    soundsOn(both.played, CUES.complete, both.frame),
    0,
    "CUES.complete sounds on the boundary frame",
  );
  assertLessThanOrEqual(
    both.played.filter((entry) => entry.cue === CUES.constellation).length,
    1,
    "and CUES.constellation no more than once, however many constellations the boundary consumed",
  );
  assertLessThanOrEqual(
    both.played.filter((entry) => entry.cue === CUES.complete).length,
    1,
    "and CUES.complete no more than once",
  );
});
