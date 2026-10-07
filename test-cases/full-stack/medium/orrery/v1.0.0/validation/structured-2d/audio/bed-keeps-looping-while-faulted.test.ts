// audio/bed-keeps-looping-while-faulted — a faulted run does not stop the bed.
//
// THE RULE. "`music` is looping on every frame the game runs, on `title`,
// `howto`, `select`, and `editor` alike, IN EVERY SIM STATUS" (`specs/ui.md`,
// Audio). `faulted` is one of the four statuses of `specs/simulation.md`, and it
// is the one that ENDS things: "A fault freezes the run where it stood". What it
// freezes is the run — the bed is not the run, and `specs/ui.md` admits no status
// in which it stops.
//
// THE WORLD. A bare run carrying one piston at `ARM_MAX_LEN` (`3`) whose tape
// cell is `extend`, which `specs/simulation.md`'s fault table names
// `overextended`: "`extend` on a piston already at `ARM_MAX_LEN` (`3`)". The
// cycle is run until the fault is raised, AND THEN THE WINDOW OPENS — the frame
// the fault lands on sounds `CUES.halt`, which is the subject of another point,
// so the frames this one reads begin after it. Past a fault nothing advances and
// nothing else can sound, so every sound in the window is the bed's.
//
// THE VERDICT. Over the window the build is running the bed on every frame, and
// `sim.status` was `faulted` on every one of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { ARM_MAX_LEN } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  openTitle,
  type Harness,
} from "../harness";
import { statusesOf, watchBed } from "./bed";
import { openSilence } from "./silence";

/** Frames the faulted run is read over. */
const FRAMES = 12;

/** The whole machine: one piston already at its maximum, told to extend. */
const OVEREXTENDING = solution([
  armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MAX_LEN, ["extend"]),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the bed running on every frame of a faulted run", async () => {
  await openTitle(h);
  await openSilence(h);

  await openBareRun(h, { challenge: BARE, machine: OVEREXTENDING });
  await advanceCycles(h, 1);
  await h.advance(1);
  const faulted = await h.snapshot();
  assertEqual(
    faulted.sim?.status,
    "faulted",
    "the world this point reads is a run frozen by a fault",
  );
  assertEqual(
    faulted.sim?.fault?.kind,
    "overextended",
    "extend on a piston already at ARM_MAX_LEN is overextended, which is the fault posed here",
  );

  const window = await watchBed(h, FRAMES);

  await captureStill(h, "faulted");

  assertDeepEqual(
    window.stopped,
    [],
    "the bed is looping on every frame while sim.status is faulted",
  );
  assertDeepEqual(
    statusesOf(window),
    ["faulted"],
    "and every frame it was read on was a frame of the faulted run",
  );
});
