// audio/bed-keeps-looping-while-complete — a completed run does not stop the bed.
//
// THE RULE. "`music` is looping on every frame the game runs, on `title`,
// `howto`, `select`, and `editor` alike, IN EVERY SIM STATUS" (`specs/ui.md`,
// Audio). `complete` is the last of the four statuses of `specs/simulation.md`,
// and it is the one a player sits in: the run has ended, the solved panel of
// `specs/ui.md` is up over the field, and the game waits. A bed that stops when
// the run stops leaves that panel in silence.
//
// THE WORLD. A run on a posed challenge whose only part is the set for its one
// product, its tally posed AT the challenge's target through `setTally`, and the
// completion switch left on. "After the rises, if every set's tally has reached
// the challenge's `target`, the run completes" (`specs/simulation.md`), so the
// next boundary ends the run. THE WINDOW OPENS AFTER THAT BOUNDARY: the frame the
// run completes on sounds `CUES.complete`, which is another point's subject, and
// past a completion nothing advances and nothing else can sound — so every sound
// in the window is the bed's.
//
// THE VERDICT. Over the window the build is running the bed on every frame, and
// `sim.status` was `complete` on every one of them, with the metrics recorded
// beside it as a completed run reports them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import { setPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openRun,
  openTitle,
  type Harness,
} from "../harness";
import { statusesOf, watchBed } from "./bed";
import { openSilence } from "./silence";

/** Frames the completed run is read over. */
const FRAMES = 12;

/** The whole machine: one set for the challenge's only product, at the origin. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the bed running on every frame of a completed run", async () => {
  await openTitle(h);
  await openSilence(h);

  await openRun(h, { challenge: BARE, machine: ONE_SET });
  await h.debug.setTally(0, CONSTELLATION_TARGET);
  await advanceCycles(h, 1);
  await h.advance(1);
  const complete = await h.snapshot();
  assertEqual(
    complete.sim?.status,
    "complete",
    "the world this point reads is a run that has completed, with the solved panel up",
  );
  assertNotNull(
    complete.sim?.metrics ?? null,
    "the metrics are recorded when the run completes, so this really is the completed state",
  );

  const window = await watchBed(h, FRAMES);

  await captureStill(h, "solved");

  assertDeepEqual(
    window.stopped,
    [],
    "the bed is looping on every frame while sim.status is complete",
  );
  assertDeepEqual(
    statusesOf(window),
    ["complete"],
    "and every frame it was read on was a frame of the completed run",
  );
});
