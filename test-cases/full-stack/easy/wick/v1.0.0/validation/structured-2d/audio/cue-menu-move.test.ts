// Wick — audio/cue-menu-move: the frame a menu highlight moves plays
// `menu-move`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `menu-move` to "A menu highlight moves", and "Each is played on the tick
// its event happens, or on the frame for a menu event, and at most once on
// that tick." `specs/ui.md`, Menu navigation, says which menus that covers:
// "Every move of a highlight plays `menu-move`, on the level-up overlay
// included." One move on one frame is therefore exactly one `menu-move`.
//
// WHY THREE MENUS ARE DRIVEN HERE. "Every move of a highlight" is one rule
// over every screen that carries a highlight, and `specs/controls.md`'s
// screen table gives `title`, `levelup`, and `fallen`/`dawn` a moving
// highlight. Driving one screen would let a build that wired the cue into one
// menu's own code pass, so the requirement is decided on all three. Each is
// read on its own frame with its own collector.
//
// WHY THE WORLDS ARE POSED AS THEY ARE. `title` is reached by `reset`, which
// "Restores every declared field of the game's state to its title-screen
// value: the `title` screen with `menuIndex` `0`". `levelup` is reached from
// an isolated run holding nothing with one level-up queued and the one tick
// that opens the overlay, and `fallen` from the same isolated run with `hp`
// posed to `0` and one tick. Every route is the screen's own real entry with
// `menuIndex` `0`, and no route passes through another menu, so a build with
// a broken title still has its overlay and its end screen decided here.
//
// The move itself is a real `ArrowDown`: `specs/controls.md` binds `down` to
// `ArrowDown`, read as an edge on every screen but `playing`, and a pose
// "sounds nothing", so the event this cue belongs to only happens on a frame
// a key press makes. On each screen `menuIndex` is `0` on entering and the
// menu holds more than one item, so `down` moves the highlight rather than
// wrapping onto itself.
//
// THE TOLERANCE. None: the specification fixes the cue to the frame of the
// move and to at most one play on it, and the collector reads whole frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  endFallen,
  openLevelUp,
  tap,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

/** The key `specs/controls.md` binds `down` to. */
const DOWN = "ArrowDown";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays menu-move once on the frame a highlight moves on title, levelup, and fallen", async () => {
  await captureReplay(h, "move", async () => {
    h.reset();
    assertEqual(h.snapshot().screen, "title", "the screen reset restored");
    const title = await cuesOf(h, () => tap(h, DOWN));
    assertEqual(
      title.result.menuIndex,
      1,
      "menuIndex after one down on the title menu (specs/ui.md, title)",
    );
    assertEqual(
      heard(title.played, CUES.menuMove),
      1,
      "menu-move cues on the frame the title highlight moved (specs/ui.md, Audio)",
    );

    await isolatedRun(h);
    const opened = await openLevelUp(h, 1);
    assertEqual(opened.screen, "levelup", "the screen the overlay opened on");
    const overlay = await cuesOf(h, () => tap(h, DOWN));
    assertEqual(
      overlay.result.menuIndex,
      1,
      "menuIndex after one down on the level-up overlay (specs/ui.md, levelup)",
    );
    assertEqual(
      heard(overlay.played, CUES.menuMove),
      1,
      "menu-move cues on the frame the overlay's highlight moved (specs/ui.md, Audio)",
    );

    await isolatedRun(h);
    const ended = await endFallen(h);
    assertEqual(ended.screen, "fallen", "the screen the ending tick left");
    const end = await cuesOf(h, () => tap(h, DOWN));
    assertEqual(
      end.result.menuIndex,
      1,
      "menuIndex after one down on the end menu (specs/ui.md, fallen and dawn)",
    );
    assertEqual(
      heard(end.played, CUES.menuMove),
      1,
      "menu-move cues on the frame the end menu's highlight moved (specs/ui.md, Audio)",
    );
  });
});
