// screens/title-screen — the game rests on the title, and the title screen
// carries what specs/ui.md says it carries.
//
// specs/ui.md: the `title` screen shows "The title `TITLE_TEXT` (`DEEPCORE`), a
// tagline, and the main menu", and "the highlighted item is drawn distinctly from
// the others". specs/instrumentation.md fixes the same screen as the resting
// state a `reset` restores, "the `title` screen with `menuIndex` at `0`".
//
// FOUR READINGS OF ONE FRAME.
//
//   - The state says `title`, with the highlight at 0.
//   - The frame drew `TITLE_TEXT`.
//   - The frame drew every entry of the main menu.
//   - The frame drew a TAGLINE: a run of text that is neither the title nor one
//     of the menu entries. specs/ui.md fixes no words for it, so what is read is
//     that there is copy on the screen beyond its name and its menu.
//
// And a fifth reading, of two frames: the highlight is drawn distinctly. That
// cannot be read as a colour, because the specification fixes no palette, so it
// is read as a difference — the frame with the second entry highlighted differs
// from the frame with the first more than two frames at the same highlight differ
// from each other, which is what tells a highlight apart from an animation.
//
// ISOLATION. A fresh page reset to its resting state with the save slot cleared,
// so the menu is the one specs/ui.md lists with no save banked and nothing on the
// screen belongs to an expedition.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TITLE_ITEMS_NO_SAVE, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  drewText,
  type Harness,
} from "../harness";
import { frameDistance, framesAtIndices } from "./frames";

/** The shortest run of text that counts as a tagline rather than a stray glyph. */
const TAGLINE_MIN = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rests on the title, naming the game and drawing its menu", async () => {
  await h.debug.clearSave();
  await h.debug.reset();

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "specs/instrumentation.md: reset restores the title screen",
  );
  assertEqual(
    opened.menuIndex,
    0,
    "specs/instrumentation.md: reset leaves menuIndex at 0",
  );
  assertEqual(
    drewText(calls, TITLE_TEXT),
    true,
    `specs/ui.md: the title screen shows TITLE_TEXT (${TITLE_TEXT})`,
  );
  for (const item of TITLE_ITEMS_NO_SAVE) {
    assertEqual(
      drewText(calls, item),
      true,
      `specs/ui.md: the title screen draws ${item}`,
    );
  }

  // A run that is not simply the title or one of the entries, however a build
  // marks the highlighted one.
  const named: readonly string[] = [TITLE_TEXT, ...TITLE_ITEMS_NO_SAVE].map(
    (text) => text.toUpperCase(),
  );
  const tagline = drawnText(calls)
    .map((run) =>
      run
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, " ")
        .trim(),
    )
    .filter((text) => text.length >= TAGLINE_MIN && !named.includes(text));
  assertGreaterThan(
    tagline.length,
    0,
    "specs/ui.md: the title screen shows a tagline beside its name and menu",
  );

  // The highlight, read as a difference rather than as a colour.
  const { frames, still } = await framesAtIndices(h, [0, 1]);
  const idle = frameDistance(frames[0], still);
  const moved = frameDistance(frames[0], frames[1]);
  assertGreaterThan(
    moved,
    idle,
    "specs/ui.md: the highlighted item is drawn distinctly from the others",
  );
});
