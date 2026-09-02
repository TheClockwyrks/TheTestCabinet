// Wick — audio/cue-menu-confirm: the frame a menu item is confirmed plays
// `menu-confirm`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `menu-confirm` to "An item of `TITLE_ITEMS` or `END_ITEMS` is confirmed",
// and "Each is played on the tick its event happens, or on the frame for a
// menu event, and at most once on that tick." `specs/ui.md`, Menu
// navigation, states the same bound: "`menu-confirm` plays when an item of
// `TITLE_ITEMS` or `END_ITEMS` is confirmed". One confirmation on one frame
// is therefore exactly one `menu-confirm`.
//
// WHY BOTH MENUS ARE DRIVEN HERE. The rule names exactly two lists, so
// deciding it means deciding both. A build that sounds the cue on the title
// and not on an end screen has met the rule on one of the two lists it names.
//
// WHY THE WORLDS ARE POSED AS THEY ARE.
//
//   - The TITLE route is `reset`, which restores "the `title` screen with
//     `menuIndex` `0`", one `ArrowDown` onto `HOW TO PLAY` — the second of
//     `TITLE_ITEMS` (`specs/ui.md`, title) — and `Enter` on it. `HOW TO PLAY`
//     is chosen over `LIGHT THE LAMP` because it "Sets `screen = howto`" and
//     starts no run, so the confirming frame carries the confirmation alone.
//   - The END route is an isolated run holding nothing with `hp` posed to `0`
//     and one tick, which ends it fallen; `menuIndex` is `0` on arriving and
//     the first of `END_ITEMS` is `TRY AGAIN`, so `Enter` confirms it with no
//     move first.
//
// Both confirmations are a real `Enter`, which `specs/controls.md` binds to
// `confirm` as an edge; a pose "sounds nothing", so the event this cue
// belongs to only happens on a frame a key press makes. The `ArrowDown` of
// the title route is driven outside the collector, so its own `menu-move` is
// not in the reading.
//
// THE TOLERANCE. None: the specification fixes the cue to the frame of the
// confirmation and to at most one play on it, and the collector reads whole
// frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  endFallen,
  tap,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

/** The keys `specs/controls.md` binds `down` and `confirm` to. */
const DOWN = "ArrowDown";
const CONFIRM = "Enter";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays menu-confirm once on the frame a title item and an end item are confirmed", async () => {
  await captureReplay(h, "confirm", async () => {
    h.reset();
    const moved = await tap(h, DOWN);
    assertEqual(
      moved.menuIndex,
      1,
      "menuIndex on HOW TO PLAY, the second of TITLE_ITEMS (specs/ui.md)",
    );
    const title = await cuesOf(h, () => tap(h, CONFIRM));
    assertEqual(
      title.result.screen,
      "howto",
      "the screen confirming HOW TO PLAY left (specs/ui.md, title)",
    );
    assertEqual(
      heard(title.played, CUES.menuConfirm),
      1,
      "menu-confirm cues on the frame a title item was confirmed (specs/ui.md, Audio)",
    );

    await isolatedRun(h);
    const ended = await endFallen(h);
    assertEqual(ended.screen, "fallen", "the screen the ending tick left");
    assertEqual(
      ended.menuIndex,
      0,
      "menuIndex on TRY AGAIN, the first of END_ITEMS (specs/ui.md)",
    );
    const end = await cuesOf(h, () => tap(h, CONFIRM));
    assertEqual(
      end.result.screen,
      "playing",
      "the screen confirming TRY AGAIN left (specs/ui.md, fallen and dawn)",
    );
    assertEqual(
      heard(end.played, CUES.menuConfirm),
      1,
      "menu-confirm cues on the frame an end item was confirmed (specs/ui.md, Audio)",
    );
  });
});
