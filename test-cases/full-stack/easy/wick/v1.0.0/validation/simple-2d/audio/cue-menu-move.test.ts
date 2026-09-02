// Wick — audio/cue-menu-move: a frame on which `down` moves a menu highlight
// plays `menu-move`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`menu-move` | `CUES.menuMove` | A menu highlight
//     moves", and "Each is played ... on the frame for a menu event".
//   - specs/ui.md (Menu navigation): "Every move of a highlight plays
//     `menu-move`, on the level-up overlay included".
//   - specs/ui.md: on `title` "`up` and `down` move the highlight by one item
//     and wrap at both ends"; on `levelup` "`up` and `down` move the highlight
//     and wrap at both ends"; on the end screens "`up` and `down` move the
//     highlight and wrap". "`menuIndex` is `0` on arriving".
//   - specs/controls.md: `down` is bound to `ArrowDown` and `KeyS` and is read
//     as a press edge on every screen but `playing`.
//
// WHAT IS READ. Exactly one `menu-move` play across the one frame the press
// runs on, on each of the three screens that carry a highlight, with
// `menuIndex` risen from `0` to `1` on each as the evidence that a highlight
// really moved.
//
// WHY THE SCREENS ARE REACHED AS THEY ARE. Each is entered through the debug
// surface, "exactly as the real transition into it enters it"
// (specs/instrumentation.md, `setScreen`), so a build with a broken menu route
// still reaches the screen this point is about. The level-up overlay is opened
// from an isolated night with nothing on the field and every driver switch off,
// through a queued level-up rather than a gem, so no other cue lands on the
// frames recorded. Only `down` is pressed, since the requirement is that a move
// sounds and `up` is the same move in the other direction.
//
// TOLERANCE. None. Every reading is a count or a discrete index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  onCue,
  openLevelUp,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { DOWN_KEY, assertPlayed } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays menu-move on the frame a highlight moves on title, levelup, and fallen", async () => {
  poseScene(h, "title");
  const onTitle = onCue(h);

  const title = await captureReplay(h, "move", () => tap(h, DOWN_KEY));

  assertEqual(title.menuIndex, 1, "the title highlight after the press");
  assertPlayed(onTitle, "menu-move", 1, "menu-move cues on the title's frame");

  isolate(h);
  const opened = await openLevelUp(h, 1);
  assertEqual(opened.screen, "levelup", "the screen the overlay opened on");
  const onOverlay = onCue(h);

  const overlay = await tap(h, DOWN_KEY);

  assertEqual(overlay.menuIndex, 1, "the overlay highlight after the press");
  assertPlayed(
    onOverlay,
    "menu-move",
    1,
    "menu-move cues on the overlay's frame",
  );

  poseScene(h, "fallen");
  const onFallen = onCue(h);

  const fallen = await tap(h, DOWN_KEY);

  assertEqual(fallen.menuIndex, 1, "the fallen highlight after the press");
  assertPlayed(onFallen, "menu-move", 1, "menu-move cues on the fallen frame");
});
