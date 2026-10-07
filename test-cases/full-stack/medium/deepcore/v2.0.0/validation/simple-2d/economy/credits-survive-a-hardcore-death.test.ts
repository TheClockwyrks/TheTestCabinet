// economy/credits-survive-a-hardcore-death — the balance is banked, not staked.
//
// `specs/expedition.md` says it plainly: "Credits are banked: once earned they
// survive a death in either mode." `specs/modes.md` adds that the mode changes
// only what a death costs, so each mode is its own check: a build that banks the
// balance through a Standard death and wipes it on a Hardcore one must fail here
// and pass `economy/credits-survive-a-standard-death`.
//
// The death itself is hull reaching `0`, which `specs/modes.md` lists as a death
// cause and `specs/instrumentation.md` makes drivable: "A hull posed to `0` is
// not itself a death: the game's own continuous check is what ends the
// expedition, on the next update." So the hull is posed and the game's own rule
// ends the expedition on the frames that follow.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";

/** The banked balance the death must not touch. */
const CREDITS = 1234;

/**
 * Game time the death is given to reach the Game Over screen, and the frames it
 * is run in.
 *
 * `specs/modes.md` fixes that a death ends the expedition at the Game Over
 * screen and fixes nothing about how long whatever a build plays on the way
 * takes, so the check gives it a generous bounded span rather than reading the
 * next frame. Ten seconds of game time in a hundred frames: every rate is
 * integrated against the frame's delta, so the coarser division reaches the same
 * state as ten thousand frames would.
 */
const DEATH_SECONDS = 10;
const DEATH_FRAMES = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the banked Credits into a Hardcore death", async () => {
  openScene(h, { mode: "hardcore" });
  layCamp(h);
  standAtCamp(h);
  pinDrill(h);
  h.debug.setCredits(CREDITS);
  h.debug.setHull(0);
  await h.advanceSeconds(DEATH_SECONDS, DEATH_FRAMES);
  captureStill(h, "banked");

  const after = h.snapshot();
  assertEqual(after.screen, "game-over", "specs/modes.md");
  assertEqual(after.credits, CREDITS, "specs/expedition.md");
  assertNotNull(after.summary, "specs/expedition.md");
  assertEqual(after.summary?.mode, "hardcore", "specs/expedition.md");
});
