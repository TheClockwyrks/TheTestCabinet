// audio/bed-keeps-looping-while-running — a live run does not stop the bed.
//
// THE RULE. "`music` is looping on every frame the game runs, on `title`,
// `howto`, `select`, and `editor` alike, IN EVERY SIM STATUS" (`specs/ui.md`,
// Audio). `running` is the first of the four `specs/simulation.md` names —
// "`sim.status` is one of `running`, `paused`, `faulted`, and `complete`" — and it
// is the status under which the game is doing the most: the cycle counter climbs,
// the fraction advances, and a build that re-uses its audio for the run's own cues
// has the most to get wrong here.
//
// THE WORLD. A bare run on a posed challenge, opened with the completion switch
// held off and the field emptied, carrying ONE arm with an empty tape. "A blank
// cell is a rest on every part, a wheel included, and never faults"
// (`specs/simulation.md`), so the run turns cycle after cycle while nothing is
// carried, nothing is delivered, nothing is transmuted and nothing faults — which
// is what makes every sound heard in the window the bed's, since none of the six
// one-shot cues of `specs/ui.md` has an event to sound on.
//
// THE VERDICT. Over frames covering several whole cycles the build is running the
// bed on every one of them, and `sim.status` was `running` on every one of them —
// read from the frames themselves, so a run that quietly stopped part way cannot
// leave this point deciding something else.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { FRAMES_PER_CYCLE } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openBareRun,
  openTitle,
  type Harness,
} from "../harness";
import { statusesOf, watchBed } from "./bed";
import { openSilence } from "./silence";

/** Frames the run is read over: three whole cycles at the default speed. */
const FRAMES = 3 * FRAMES_PER_CYCLE;

/** The whole machine: one arm at rest, whose empty tape moves nothing. */
const IDLE_ARM = solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the bed running on every frame of a running run", async () => {
  await openTitle(h);
  await openSilence(h);

  await openBareRun(h, { challenge: BARE, machine: IDLE_ARM });
  const opened = await h.snapshot();
  assertEqual(
    opened.sim?.status,
    "running",
    "the world this point reads is a live, running run",
  );
  assertEqual(
    opened.sim?.motes.length,
    0,
    "the field is empty, so no delivery and no collision can sound a cue of its own",
  );

  const window = await captureReplay(h, "bed-running", () =>
    watchBed(h, FRAMES),
  );

  assertDeepEqual(
    window.stopped,
    [],
    "the bed is looping on every frame while sim.status is running",
  );
  assertDeepEqual(
    statusesOf(window),
    ["running"],
    "and every frame it was read on was a frame of a running run",
  );
  assertGreaterThan(
    (await h.snapshot()).sim?.cycle ?? 0,
    0,
    "the run really was advancing through those frames, rather than standing still under the bed",
  );
});
