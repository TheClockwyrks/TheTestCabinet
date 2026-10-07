// screens/title-draws-its-menu-entries-in-order — the title screen draws its
// menu entries in order.
//
// `specs/ui.md` § The screens, Title: "The game opens on `title`, showing
// `TITLE_TEXT` (`GANTRY`), `TAGLINE_TEXT` (`RIG THE CRANE. RUN THE TAPE.`), and
// the menu `TITLE_ITEMS` (`SITES`, `HOW TO PLAY`), with `menuIndex` `0` on
// arriving." The copy is the case's; how it is set is the build's.
//
// THAT SENTENCE NAMES FOUR PIECES OF COPY, and each is a check of its own —
// `screens/title-draws-the-title`, `-the-tagline`, `-the-sites-entry` and
// `-the-howto-entry`. This one is the fifth thing the sentence fixes and the
// only one none of those decide: the ORDER the two menu entries stand in, which
// `TITLE_ITEMS` lists rather than describes.
//
// WHAT IS READ IS THE FRAME'S OWN TEXT, not the snapshot: the snapshot says
// which screen is showing and says nothing about where on it a run of text
// landed, and where the two entries landed relative to one another is the whole
// of this point. The reading is the operations the build issued against its 2D
// context on the last frame, which `h.screenCalls()` answers with every text
// call measured.
//
// MATCHING IGNORES HOW THE COPY IS BROKEN UP AND SPACED. A build is free to
// draw a menu entry with a selection marker beside it, to letter-space a title
// into one call per glyph, or to set the tagline over two lines, so each entry
// is looked for among the frame's logical runs — the shared harness's
// `drawnTextRuns`, in the reading order it hands them over in — joined with the
// whitespace folded out, and what is compared is the run each entry starts in
// (`./reading`). What is asserted is the order alone — `SITES` before `HOW TO
// PLAY`, as `TITLE_ITEMS` lists them — and never a position, a font, or a
// colour.
//
// AND ONLY WHERE BOTH ENTRIES WERE DRAWN. An entry the screen never drew is
// already named by `screens/title-draws-the-sites-entry` or
// `screens/title-draws-the-howto-entry`, so this point stands down rather than
// failing for it: a build that drew neither entry must not grade below one that
// drew both in the wrong order.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextRuns } from "../case-harness/index";
import { assertTrue } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";
import { runStarting } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws its menu entries in the order TITLE_ITEMS lists them", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(0);
  await h.advance(1);

  const runs = drawnTextRuns(await h.screenCalls());
  await h.capture("menu-order", "The title screen's menu entries");

  assertTrue(
    runs.length > 0,
    "the title screen to draw text at all (specs/ui.md)",
  );

  const sites = runStarting(runs, TITLE_ITEMS[0]);
  const howto = runStarting(runs, TITLE_ITEMS[1]);
  // An entry that was never drawn belongs to the item that names it, so this
  // point stands down rather than failing for someone else's miss.
  if (sites === null || howto === null) return;

  assertTrue(
    sites < howto,
    `"${TITLE_ITEMS[0]}" to be drawn before "${TITLE_ITEMS[1]}", the order ` +
      "TITLE_ITEMS lists them in (specs/ui.md)",
  );
});
