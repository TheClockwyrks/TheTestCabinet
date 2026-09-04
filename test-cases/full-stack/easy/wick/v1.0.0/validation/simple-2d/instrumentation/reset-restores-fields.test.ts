// instrumentation/reset-restores-fields — from a thoroughly disturbed run,
// `reset()` returns the game to title with menuIndex 0, almanacTab 0,
// almanacScroll 0, the idle run of specs/state.md, and the accumulator and
// simTime at 0.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `reset`: "Restores
// every declared field of the game's state to its title-screen value: the
// `title` screen with `menuIndex`, `almanacTab`, and `almanacScroll` all `0`,
// the idle run of `specs/state.md`, the accumulator and `simTime` at `0`, and
// every driver switch on". The idle run is the table under specs/state.md, "The
// idle run", `hurtFlash` `0` among its rows, restated as `IDLE_RUN` in
// `helpers.ts` with the derived fields the snapshot adds to it.
//
// THE DISTURBANCE, IN TWO PARTS, because no one screen carries all of what a
// reset restores. The busy night poses every region of a run a lazy reset could
// leave behind, a partial frame leaves the accumulator above 0 and simTime
// above 0, and a tick has the world carrying its own hits entry. The almanac
// then poses the three indices, which are the only fields the run cannot hold:
// `almanacTab` and `almanacScroll` "are `0` on every screen but `almanac`"
// (specs/instrumentation.md), so the almanac walked with real key edges is the
// one state in which a reset has anything to put back.
//
// Each half is read WITHOUT A FRAME after its reset: the values are restored
// "once the call returns", and a frame would move simTime again.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_ENTRIES, ALMANAC_ROWS, ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { assertIdleRun, poseBusyNight } from "./helpers";

/** A frame of 25 ms on playing: one tick and a remainder in the accumulator. */
const PARTIAL_FRAME_SECONDS = 0.025;

/**
 * The tab the almanac is walked to: the first past the first that holds more
 * entries than the list shows, so `almanacTab` and `almanacScroll` are both off
 * `0` at once (specs/ui.md, `almanac`).
 */
const SCROLLING_TAB = ALMANAC_TABS.findIndex(
  (tab, index) => index > 0 && ALMANAC_ENTRIES[tab].length > ALMANAC_ROWS,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores the title state, the three indices, and the idle run", async () => {
  poseBusyNight(h);
  const disturbed = await h.frameOf(PARTIAL_FRAME_SECONDS);
  assertGreaterThan(
    disturbed.accumulator,
    0,
    "the accumulator before the reset",
  );
  assertGreaterThan(disturbed.simTime, 0, "simTime before the reset");
  assertGreaterThan(
    disturbed.run.enemies.length,
    0,
    "the enemies before the reset",
  );

  h.reset();
  const s = h.snapshot();

  assertEqual(s.screen, "title", "the screen a reset leaves");
  assertEqual(s.menuIndex, 0, "menuIndex after the reset");
  assertIdleRun(s.run, "run after the reset: the idle run");
  assertEqual(s.accumulator, 0, "the accumulator after the reset");
  assertEqual(s.simTime, 0, "simTime after the reset");

  // The three indices, posed where they are the only thing the state holds.
  poseScene(h, "almanac");
  for (let step = 0; step < SCROLLING_TAB; step += 1)
    await tap(h, "ArrowRight");
  for (let step = 0; step < ALMANAC_ROWS; step += 1) await tap(h, "ArrowDown");
  const walked = h.snapshot();
  assertEqual(walked.almanacTab, SCROLLING_TAB, "almanacTab before the reset");
  assertGreaterThan(walked.menuIndex, 0, "menuIndex before the reset");
  assertGreaterThan(walked.almanacScroll, 0, "almanacScroll before the reset");

  h.reset();
  const back = h.snapshot();
  await h.tick(1);
  captureStill(h, "reset");

  assertEqual(back.screen, "title", "the screen a reset leaves the almanac in");
  assertEqual(back.menuIndex, 0, "menuIndex the reset restores");
  assertEqual(back.almanacTab, 0, "almanacTab the reset restores");
  assertEqual(back.almanacScroll, 0, "almanacScroll the reset restores");
  assertIdleRun(back.run, "run after the second reset: the idle run");
});
