// screens/title — the title screen draws its copy, and highlights one entry.
//
// THE REQUIREMENT. `specs/ui.md` fixes the title's copy exactly: `TITLE_TEXT`
// (`ARC FOUNDRY`), `TAGLINE_TEXT` (`GROUND THE LOAD`) and `TITLE_ITEMS`
// (`SALVAGE`, `HOW TO PLAY`, in that order). It fixes two things about the
// highlight as well: "The item at the current menu index is highlighted and drawn
// distinctly from the others, and the index is `0` on arriving at the title."
// `specs/instrumentation.md` has `reset` return the game to exactly that state.
//
// HOW IT IS DECIDED. Two readings of the same frame, and then a third frame for
// the highlight.
//
//   The state. After `reset` the screen reads `title` with `menuIndex` `0`.
//   The copy. The frame's own text draws carry the title, the tagline and both
//   menu entries. Matching is by substring and ignores case, because
//   `specs/ui.md` leaves the layout, the palette and the type to the build and a
//   menu entry is commonly drawn with a marker beside it.
//   The highlight. The same first frame is drawn again in a SECOND engine with
//   the highlight posed on the other entry, and the two frames must differ. Two
//   fresh engines at the same frame number is what makes that comparison fair: a
//   build that animates its title off the frame counter draws the same thing on
//   frame one of both, so the only thing that can separate them is the highlight
//   — and a build that draws the two entries identically whichever is current
//   draws no highlight at all.

import { afterEach, beforeEach, it } from "vitest";

import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../../src/constants";
import { assertEqual, assertNotEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drewText } from "./reading";

let h: Harness;
let other: Harness | null = null;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
  if (other !== null) other.dispose();
  other = null;
});

it("draws its title, its tagline and both menu entries", async () => {
  h.debug.reset();
  const calls = await h.frameCalls();
  captureStill(h, "title");

  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "the screen a reset returns the game to (specs/ui.md)",
  );
  assertEqual(
    opened.menuIndex,
    0,
    "the highlighted entry on arriving at the title (specs/ui.md)",
  );

  assertEqual(
    drewText(calls, TITLE_TEXT),
    true,
    `the title screen to draw TITLE_TEXT, ${TITLE_TEXT} (specs/ui.md)`,
  );
  assertEqual(
    drewText(calls, TAGLINE_TEXT),
    true,
    `the title screen to draw TAGLINE_TEXT, ${TAGLINE_TEXT} (specs/ui.md)`,
  );
  for (const item of TITLE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the title screen to draw its ${item} entry (specs/ui.md)`,
    );
  }
});

it("draws the entry at the current index distinctly from the others", async () => {
  h.debug.reset();
  h.debug.setMenuIndex(0);
  const first = await h.frameCalls();

  // A second engine, so the comparison is between frame one of one title and
  // frame one of another: anything the build draws off its own frame counter is
  // identical in both, and the highlight is the only thing left that differs.
  other = await createHarness();
  other.debug.reset();
  other.debug.setMenuIndex(TITLE_ITEMS.length - 1);
  const last = await other.frameCalls();

  assertNotEqual(
    JSON.stringify(first),
    JSON.stringify(last),
    "the title's frame to change when the highlight moves from the first " +
      "entry to the last, because the item at the current menu index is drawn " +
      "distinctly from the others (specs/ui.md)",
  );
});
