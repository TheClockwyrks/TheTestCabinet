// audio/music-restarts-on-pause-restart — RESTART from the pause menu starts the
// bed again.
//
// specs/ui.md fixes the event: `music` plays when "a round begins", and the bed
// "loops under the round it began with". And of the pause menu: "`RESTART`
// starts a fresh round in the same mode." A fresh round beginning is a round
// beginning, so the bed sounds for it.
//
// WHY THE PAUSE PATH IS ITS OWN POINT. `music-cue-plays` decides the title path
// and nothing else: it watches a bed start on a board that had none under it. The
// pause is the one entry into a fresh round the previous round's bed is STILL
// RUNNING at — the pause never ended that round — so a build that starts the bed
// only when none is playing gets the title right and this wrong. That is a
// different observable behaviour, so it is a different point.
//
// WHY EVERY SCREEN HERE IS REACHED BY PRESSING A KEY. What the point is about is
// a round BEGINNING, and `specs/instrumentation.md` says a posed screen is not
// one: "moving to `playing` this way runs the tick over the board as it stands
// rather than laying out a fresh round". Only a menu accepting its item begins a
// round, so the drive runs title to round to pause to restart. The highlight is
// posed onto `RESTART` rather than pressed for, so a build whose highlight will
// not move fails `controls/menu-highlight-moves` alone rather than losing this
// point to it.
//
// WHAT IS ASSERTED. That the fresh round was actually laid — a build that merely
// returned to `playing` has not begun a round and is failing `states/pause-restart`
// rather than this — and that a `music` cue was asked for from the moment the
// restart was confirmed. Nothing is asserted about the bed that was already
// running, since `specs/ui.md` fixes when the cue plays and leaves how a build
// retires the old source to the build.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { BINDINGS, CUES, PAUSE_ITEMS, START_CELLS } from "../../src/constants";

import {
  captureReplay,
  createHarness,
  cuesNamed,
  startRoundWithKeys,
  watchCues,
  type Harness,
} from "../harness";

/** `RESTART` is the second item of `PAUSE_ITEMS` (specs/ui.md). */
const RESTART_INDEX = PAUSE_ITEMS.indexOf("RESTART");

/** Ticks of the first round driven before it is paused, so the bed is under it. */
const ROUND_TICKS = 8;

/** The first key `specs/controls.md` binds to `confirm`. */
const CONFIRM = BINDINGS.confirm[0];

/** The first key `specs/controls.md` binds to `pause`. */
const PAUSE = BINDINGS.pause[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("asks for the music cue again on the round RESTART lays out", async () => {
  await startRoundWithKeys(h);
  await h.tick(ROUND_TICKS);

  await h.tap(PAUSE);
  const paused = h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the pause opened");
  h.debug.setMenuIndex(RESTART_INDEX);

  // Opened after the first round's bed has already sounded, so what it holds is
  // the restart's own cues and none of the first round's.
  const cues = watchCues(h);

  const fresh = await captureReplay(h, "restart", async () => {
    await h.tap(CONFIRM);
    const begun = h.snapshot();
    await h.tick(ROUND_TICKS);
    return begun;
  });

  assertEqual(fresh.screen, "playing", "the screen RESTART opened");
  assertDeepEqual(
    fresh.snake,
    START_CELLS,
    "the chain the fresh round opens on",
  );
  assertGreaterThanOrEqual(
    cuesNamed(cues, CUES.music).length,
    1,
    "music cues sounded from the restart onward",
  );
});
