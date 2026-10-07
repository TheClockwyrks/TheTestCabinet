// audio/bed-keeps-looping-while-paused — a paused run does not stop the bed.
//
// THE RULE. "`music` is looping on every frame the game runs, on `title`,
// `howto`, `select`, and `editor` alike, IN EVERY SIM STATUS" (`specs/ui.md`,
// Audio). `paused` is one of the four statuses of `specs/simulation.md`, and it
// is the one where the game's own clock stops: "A paused run advances no
// fraction". The bed's clock is not the run's, so it goes on — and a build that
// hung its music off the simulation rather than off the frames goes quiet here.
//
// THE WORLD. A bare run on a posed challenge, one arm with an empty tape, the
// field emptied, then `setPaused(true)`, which "Moves `sim.status` between
// `running` and `paused`, exactly as the `play` toggle moves it"
// (`specs/instrumentation.md`). Nothing on the field can raise one of the six
// one-shot cues, and with the run paused nothing advances at all, so every sound
// heard in the window is the bed's.
//
// THE VERDICT. Over the window the build is running the bed on every frame,
// `sim.status` was `paused` on every one of them, and the cycle counter never
// moved — so the point was decided over a genuinely paused run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  openTitle,
  pauseRun,
  type Harness,
} from "../harness";
import { statusesOf, watchBed } from "./bed";
import { openSilence } from "./silence";

/** Frames the paused run is read over. */
const FRAMES = 12;

/** The whole machine: one arm at rest, whose empty tape moves nothing. */
const IDLE_ARM = solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the bed running on every frame of a paused run", async () => {
  await openTitle(h);
  await openSilence(h);

  await openBareRun(h, { challenge: BARE, machine: IDLE_ARM });
  await pauseRun(h);
  const opened = await h.snapshot();
  assertEqual(
    opened.sim?.status,
    "paused",
    "the world this point reads is a live run held at `paused`",
  );
  const cycle = opened.sim?.cycle ?? -1;

  const window = await watchBed(h, FRAMES);

  await captureStill(h, "paused");

  assertDeepEqual(
    window.stopped,
    [],
    "the bed is looping on every frame while sim.status is paused",
  );
  assertDeepEqual(
    statusesOf(window),
    ["paused"],
    "and every frame it was read on was a frame of a paused run",
  );
  assertEqual(
    (await h.snapshot()).sim?.cycle,
    cycle,
    "the run really was paused through those frames: a paused run advances no fraction",
  );
});
