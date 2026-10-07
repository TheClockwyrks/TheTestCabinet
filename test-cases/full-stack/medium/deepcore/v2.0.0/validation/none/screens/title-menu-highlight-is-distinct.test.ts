// screens/title-menu-highlight-is-distinct — the highlighted entry looks
// different from the others.
//
// specs/ui.md, of a menu screen: "the highlighted item is drawn distinctly from
// the others".
//
// READ AS A DIFFERENCE, NEVER AS A COLOUR. The specification fixes no palette, so
// what is read is that the frame with the second entry highlighted differs from
// the frame with the first MORE than two frames at the same highlight differ from
// each other — which is what tells a highlight apart from an animation playing
// behind it.
//
// FOUR POINTS, NOT ONE. specs/ui.md names four things about this screen — that
// the game is on it and it carries the title, that it carries a tagline, that it
// carries the main menu, and that the highlighted entry is drawn distinctly — and
// a build that gets three of them right must grade differently from one that gets
// none. The other three are `screens/title-screen-tagline`,
// `screens/title-menu-drawn` and `screens/title-menu-highlight-is-distinct`.
//
// ISOLATION. A fresh harness reset to its resting state with the save slot
// cleared, so the menu is the one specs/ui.md lists with no save banked and
// nothing on the screen belongs to an expedition.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { frameDistance, framesAtIndices } from "./frames";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the highlighted entry distinctly from the others", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.clearSave();
  await h.debug.reset();
  await captureStill(h, "highlight");

  const { frames, still } = await framesAtIndices(h, [0, 1]);
  const idle = frameDistance(frames[0], still);
  const moved = frameDistance(frames[0], frames[1]);

  assertGreaterThan(
    moved,
    idle,
    "specs/ui.md: the highlighted item is drawn distinctly from the others",
  );
});
