// Carom — ui/state-title: the title is the screen the game opens on, and it
// draws the title copy.
//
// Two readings of the same frame. The game's own state says which screen it
// believes it is on, and the frame's draw calls say what it actually put on the
// canvas, so a build that reports a title it never draws, or draws one it does
// not report, fails here rather than passing on either half alone.
//
// `reset` may rebuild its screen even when it is called on the title
// (specs/instrumentation.md), so `openTitle` settles it with one advanced frame
// before anything is read; the frame that is READ is a second one, advanced with
// the call list cleared, so what is inspected is one whole render of the settled
// screen.
//
// Nothing on the field is posed or removed. The title's world is the one `reset`
// arranges and specs/ui.md advances nothing on the title, so no ball and no
// obstacle can move between the settling frame and the frame that is read — and
// the capture shows the furniture the specification lets a build dim behind the
// menu.
//
// The copy is the case's own: TITLE_TEXT from `validation/constants.ts`, which
// states what specs/ui.md fixes. Matching is by substring, because a heading is
// commonly drawn with decoration around it. Everything else about the screen is
// the build's, rated through the domains.
//
// THE MENU'S OWN ENTRIES ARE `ui/state-title-items`'S POINT. A build that draws
// its menu but no heading is not the same build as one that draws neither: the
// first is a title screen a player can use and the second is not, so the two
// halves are graded apart and capped apart.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_TEXT } from "../constants";
import { assertEqual } from "../assert";
import { drewText } from "../case-harness/text";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens on the title and draws its name", async () => {
  await openTitle(h);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(drewText(h.calls, TITLE_TEXT), true);
});
