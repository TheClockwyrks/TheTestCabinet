// Waiting for audio that cannot arrive on the frame it was asked for.
//
// A build that loads its own produced sound files decodes them asynchronously, so
// a bed asked for on one frame starts on a later one — and a drive runs its whole
// count inside ONE evaluation in the page, where nothing the page awaits can
// settle. These two waits step a frame at a time for exactly that reason, and the
// fixture's bed reproduces it: it is asked for on one frame and starts a turn of
// the event loop later.

import { afterEach, beforeEach, expect, it } from "vitest";
import { stepUntilBed, stepUntilSound } from "../src/index";
import { CUE_EVERY, createHarness, type Harness } from "./fixture";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("steps until the build has sounded at all", async () => {
  await h.debug.startPlaying();
  expect(await h.sounds()).toBe(0);

  const started = await stepUntilSound(h);
  expect(started).toBeGreaterThan(0);
  // It stops on the first frame that sounds rather than spending its budget, so
  // a check that follows can name the frame the cue landed on.
  expect(h.frame()).toBe(CUE_EVERY);
});

it("steps until a bed that starts late is running, and counts its start", async () => {
  await h.debug.startPlaying();
  // Asked for here, and unobservable on this frame by construction.
  await h.debug.bed();
  expect(await h.loopingSounds()).toBe(0);

  expect(await stepUntilBed(h)).toBe(1);
  expect(await h.loopingSounds()).toBe(1);
  expect(await h.loopStarts()).toBe(1);
});

it("spends its budget and answers zero rather than throwing", async () => {
  // A build with no bed at all is not this helper's failure to report: the point
  // that is ABOUT the bed reaches its own assertion with its own message.
  await h.debug.startPlaying();
  expect(await stepUntilBed(h, 3)).toBe(0);
  expect(h.frame()).toBe(3);
});
