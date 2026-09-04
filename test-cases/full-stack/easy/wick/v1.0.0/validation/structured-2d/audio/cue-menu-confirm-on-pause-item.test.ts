// Wick — audio/cue-menu-confirm-on-pause-item: the frame a pause menu item is
// confirmed plays `menu-confirm`, once.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `menu-confirm` to "An item of `TITLE_ITEMS`, `PAUSE_ITEMS`, or `END_ITEMS` is
// confirmed", and "Each is played on the tick its event happens, or on the
// frame for a menu event, and at most once on that tick." `specs/ui.md`, Menu
// navigation, states the same bound: "`menu-confirm` plays when an item of
// `TITLE_ITEMS`, `PAUSE_ITEMS`, or `END_ITEMS` is confirmed". One confirmation
// on one frame is therefore exactly one `menu-confirm`.
//
// WHAT THIS DECIDES. `PAUSE_ITEMS`, the pause menu, which is the one of the
// three lists the rule names that the review point beside it does not sound.
//
// WHY `RESUME`. `specs/ui.md`, "`paused`", gives the screen the menu
// `PAUSE_ITEMS` with `RESUME` first, "`menuIndex` is `0` on arriving ...
// `confirm` takes the highlighted item", and the row "`RESUME` | Sets
// `screen = playing`, with the run untouched". `RESUME` is therefore the item
// the screen already highlights: the confirming frame is reached with no move
// pressed before it and carries no `menu-move` of its own, and the screen it
// leaves is the evidence the item really was taken.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated `playing` run holding no enemy,
// projectile, zone, gem, or pickup with every driver switch off, and the one
// frame the loops are reconciled on spent before anything is collected, so the
// music bed's own start falls outside the frame this reads. The pause is posed
// through `setScreen("paused")`, which `specs/instrumentation.md` enters
// "Exactly as `pause` does". The confirming frame enters `playing` and so "runs
// that frame's ticks" (`specs/controls.md`); over that world the tick raises no
// cue, and `music` loops across both `paused` and `playing` (`specs/ui.md`, The
// loops), so nothing starts on it either. The press is a real `Enter`, which
// `specs/controls.md` binds to `confirm` as an edge, and a pose "sounds
// nothing", so the event this cue belongs to only happens on a frame a key
// press makes.
//
// WHAT IS READ, AND WHY EXACTLY ONCE. The cues the collector holds for the ONE
// frame the press ran on, counted by name, which must be `1`. Reading that
// frame alone is what makes the count decide the rule: a cue sounded while the
// pause was being posed cannot stand in for the one the confirmation owes, and
// a build that sounds it twice on the confirming frame fails as loudly as one
// that sounds none.
//
// THE TOLERANCE. None: a screen name and a menu index are exact, and the
// collector reads whole frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES, PAUSE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  poseScreen,
  tap,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

/** The key `specs/controls.md` binds `confirm` to. */
const CONFIRM = "Enter";

/** Where `RESUME` stands in `PAUSE_ITEMS` (specs/ui.md, `paused`). */
const RESUME = PAUSE_ITEMS.indexOf("RESUME");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays menu-confirm once on the frame Enter takes RESUME", async () => {
  await captureReplay(h, "pause", async () => {
    await isolatedRun(h);
    const paused = poseScreen(h, "paused");
    assertEqual(paused.screen, "paused", "the screen the press is made on");
    assertEqual(
      paused.menuIndex,
      RESUME,
      `menuIndex on ${PAUSE_ITEMS[0]}, the first of PAUSE_ITEMS (specs/ui.md)`,
    );

    const taken = await cuesOf(h, () => tap(h, CONFIRM));
    assertEqual(
      taken.result.screen,
      "playing",
      "the screen confirming RESUME left (specs/ui.md, paused)",
    );
    assertEqual(
      heard(cuesOnFrame(taken.played, h.frame()), CUES.menuConfirm),
      1,
      "menu-confirm cues on the frame a pause item was confirmed (specs/ui.md, Audio)",
    );
  });
});
