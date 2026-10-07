// Wick — audio/cue-level-up: the tick that opens a level-up overlay plays
// `level-up`, and so does the frame on which an acceptance opens the next one.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`level-up` | `CUES.levelUp` | A level-up overlay
//     opens", and "Each is played on the tick its event happens, or on the
//     frame for a menu event".
//   - specs/progression.md (The level-up overlay): "A `playing` tick that ends
//     with `pendingLevelUps` above `0` runs to completion and then opens the
//     overlay: `screen` becomes `levelup` with `menuIndex` `0`".
//   - specs/progression.md (Choosing): "When level-ups remain queued the next
//     overlay opens immediately, with a fresh pool"; specs/ui.md says the same
//     of the overlay, "if another level-up is queued, the next overlay opens
//     with a fresh set of offers and `menuIndex = 0`".
//   - specs/instrumentation.md (`setPendingLevelUps`): "A `playing` tick that
//     ends with it above `0` opens the overlay exactly as a gain does"; a pose
//     "sounds nothing".
//
// WHAT IS READ. One `level-up` play across the tick that opens the first
// overlay, and a second across the frame whose `confirm` accepts an offer and
// opens the next queued overlay: two in all, with `screen` on `levelup` after
// each as the evidence that an overlay really opened.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon held, and every driver switch off, so no gem, kill, or hit can
// raise a cue of its own beside the overlay's. Two level-ups are queued
// through the surface rather than earned from gems, because the requirement is
// about the overlay opening and not about where the level came from, and two
// is the smallest number that makes the second overlay open on the acceptance.
// The acceptance is a real `confirm` key press, since the specification places
// the second opening on that frame.
//
// TOLERANCE. None. Both readings are counts, and the screen is discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  onCue,
  tap,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { CONFIRM_KEY, assertPlayed, playsOf } from "./cues";

/** The level-ups queued: the second is what makes the acceptance open one. */
const QUEUED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays level-up on the opening tick and again as the next overlay opens", async () => {
  isolate(h);
  h.debug.setPendingLevelUps(QUEUED);
  const cues = onCue(h);

  let onOpening = 0;
  const drive = await captureReplay(
    h,
    "levelup",
    async (): Promise<{ opened: WickSnapshot; accepted: WickSnapshot }> => {
      const opened = await h.tick(1);
      onOpening = playsOf(cues, "level-up").length;
      return { opened, accepted: await tap(h, CONFIRM_KEY) };
    },
  );

  assertEqual(drive.opened.screen, "levelup", "the screen the tick opened");
  assertEqual(
    onOpening,
    1,
    "level-up cues on the tick that opened the overlay",
  );
  assertEqual(
    drive.accepted.screen,
    "levelup",
    "the screen after the acceptance opened the next overlay",
  );
  assertPlayed(
    cues,
    "level-up",
    2,
    "level-up cues over the opening tick and the acceptance frame",
  );
});
