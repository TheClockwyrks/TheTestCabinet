// screens/title-shows-the-title — the title screen shows the title and the
// tagline.
//
// `specs/ui.md` fixes the copy of the `title` screen outright: the title is
// `TITLE_TEXT` (`SHATTER`) and the tagline is `TAGLINE_TEXT` (`GRAVITY WELL
// SHOOTER`), each named by the constant `../constants` carries it in. The
// same file makes `title` the screen "where the game opens".
//
// ON LOAD, WITH NOTHING POSED. The one frame this check runs is the game's
// first, on a harness that has called no operation on the debug surface at all:
// `specs/ui.md` says the game opens on the title, so the direct route to the
// title screen is not to pose it. A build that opens somewhere else is caught by
// the first reading rather than hidden by a `reset` that would have put the
// title up for it.
//
// TWO READINGS OF THE SAME FRAME. The game's own state says which screen it
// believes it is on, and the frame's draw calls say what it actually put on the
// canvas. A build that reports a title it never draws, and one that draws a
// title it does not report, each fail here rather than passing on one half.
//
// THE COPY IS THE CASE'S, THE LOOK IS THE BUILD'S. Matching is by containment
// and ignores case, because `specs/ui.md` leaves "the palette, the type, and the
// layout of each screen" to the build and fixes only the words. Nothing here
// asserts a position, a size or a colour.
//
// WHAT THIS DOES NOT DECIDE. The menu beneath the copy, which is
// `screens/title-menu-entries`' and `screens/title-menu-highlight`'s; or that the
// text reads against what is behind it, which the reviewer judges.

import { afterEach, beforeEach, it } from "vitest";
import { TAGLINE_TEXT, TITLE_TEXT } from "../constants";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  clearCalls,
  createHarness,
  type Harness,
} from "../harness";
import { drawnRuns } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens on the title screen and draws TITLE_TEXT and TAGLINE_TEXT", async () => {
  // The game exactly as it loaded: no pose, no reset, one frame drawn.
  clearCalls(h);
  await h.advance(1);
  captureStill(h, "title");

  const drawn = drawnRuns(h);

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the game opens on — specs/ui.md makes title the main menu " +
      "and where the game opens",
  );
  assertContains(
    drawn,
    TITLE_TEXT.toLowerCase(),
    `TITLE_TEXT drawn on the title screen's frame (specs/ui.md), among the ` +
      `runs of text that frame drew`,
  );
  assertContains(
    drawn,
    TAGLINE_TEXT.toLowerCase(),
    `TAGLINE_TEXT drawn on the title screen's frame (specs/ui.md), among the ` +
      `runs of text that frame drew`,
  );
});
