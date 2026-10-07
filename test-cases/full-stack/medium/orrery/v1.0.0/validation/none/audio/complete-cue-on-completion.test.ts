// audio/complete-cue-on-completion — the boundary that ends the run sounds
// `complete`, once, on the frame `sim.status` becomes `complete`.
//
// THE RULE. `specs/ui.md` fixes the cue and its event: "| `complete` |
// `CUES.complete` | The run completes. |", played "on the frame its event
// happens, from `update`, and at most once on that frame". What completing is, is
// `specs/simulation.md`: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes: the status becomes `complete` and the
// metrics are recorded", and the completion check is the last thing a boundary
// does — "the sigil phase, then sets, then rises, then the area bank, then the
// completion check".
//
// THE CONFIGURATION. `ONE_DELIVERY`, a challenge whose `target` is `1` —
// `specs/formats.md` requires only that a target is "at least `1`" — opened as a
// bare run, PAUSED, with ONE part on the field: the set for product `0` on
// `ORIGIN`. The tally is then posed to the target through the surface, which
// "Sets the tally of the open challenge's product `index` to `n`", and the
// completion test is let go with `setCompletion(true)`.
//
// WHY THE TALLY IS POSED RATHER THAN DELIVERED. A boundary that consumes a
// constellation sounds `constellation` on the same frame it completes on, and
// under no engine a check cannot tell two cues on one frame apart from one
// (`scenario.ts`, `cuesOf`). Posing the tally leaves the completing boundary with
// exactly ONE event on it, so the frame this check reads is a frame whose only
// cue is the one the point is about. The completion rule reads the tallies and
// nothing else, so a posed tally completes the run exactly as a delivered one
// does.
//
// WHICH FRAME THE COMPLETION IS ON. The check drives the run one frame at a time
// and reads `sim.status` after each, so the frame the status became `complete` is
// named by the snapshot rather than assumed. The cue is judged against it.
//
// THE VERDICT. The frames before the resume are silent — "on no frame before it".
// The frame the run completed on sounds, and it is the only frame that ever
// sounds, however many further frames run over the finished run.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { CUES } from "../constants";
import { setPart, solution } from "../formats";
import { ONE_DELIVERY, ORIGIN } from "../fixtures";
import {
  allowCompletion,
  captureReplay,
  createHarness,
  openBareRun,
  resumeRun,
  tallyOf,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  TAIL_FRAMES,
  driveUntil,
  openSilence,
  soundingFrames,
} from "./silence";

/** Which of the challenge's products this set receives. */
const PRODUCT = 0;

/** `ONE_DELIVERY`'s target: one accepted constellation completes the run. */
const TARGET = 1;

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

it("sounds complete once, on the frame the run's status became complete", async () => {
  await openBareRun(h, {
    challenge: ONE_DELIVERY,
    machine: solution([setPart(PRODUCT, ORIGIN.q, ORIGIN.r, 0)]),
    paused: true,
  });
  await h.debug.setTally(PRODUCT, TARGET);
  await allowCompletion(h);

  const posed = await h.snapshot();
  assertEqual(
    tallyOf(posed, PRODUCT),
    TARGET,
    "every set's tally has reached the challenge's target before the run advances",
  );
  assertEqual(
    posed.sim?.status,
    "paused",
    "and the run is still live and paused, so the completion is ahead of the window",
  );

  await openSilence(h);
  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertLength(
    soundingFrames(heard, CUES.complete),
    0,
    "the paused run crosses no boundary, so nothing sounds before the resume",
  );

  const completed = await captureReplay(h, "completed", async () => {
    await resumeRun(h);
    const frame = await driveUntil(
      h,
      (snapshot) => snapshot.sim?.status !== "running",
      2,
    );
    await h.advance(TAIL_FRAMES);
    return frame;
  });

  assertGreaterThan(
    completed,
    0,
    "the run reached a boundary and stopped running there",
  );
  assertEqual(
    (await h.snapshot()).sim?.status,
    "complete",
    "the boundary at which every tally has reached the target completes the run",
  );
  assertDeepEqual(
    soundingFrames(heard, CUES.complete),
    [completed],
    "the complete cue sounds on the frame the status became complete, on no frame before it, and on none after",
  );
});
