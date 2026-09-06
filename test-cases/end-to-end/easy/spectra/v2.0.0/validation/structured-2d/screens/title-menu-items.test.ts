// Spectra — screens/title-menu-items: the title menu lists its entries, in order.
//
// THE RULE. `specs/ui.md` gives the title menu `TITLE_ITEMS`: the mode entry
// `specs/mode.md` names, then `HOW TO PLAY`, "in that order", and it says the items
// "are stacked one above the next under the title and the tagline". So there are two
// assertable things here — that each entry is drawn, and that the mode entry is drawn
// ABOVE `HOW TO PLAY` — and this point decides both, because together they are the
// one requirement "the menu lists its items in order".
//
// THE MODE ENTRY IS READ OFF THE SNAPSHOT. `TITLE_ITEMS` opens with the entry the
// mode this build ships names — `LAUNCH` under Sortie, `OVERLOAD` under Overload
// (`specs/mode.md`) — and one validator project serves both variants, so the copy is
// asked of `titleItems(mode)` for the mode `snapshot().mode` reports. Those words are
// the specification's, written out in `./reading` rather than read off the build's
// own `TITLE_ITEMS`: a build that shipped a menu of its own would otherwise agree
// with itself and pass.
//
// ORDER IS READ AS THE ANCHOR THE BUILD DREW EACH RUN AT, mapped through whatever
// transform was in force (`drawnTextSpans`), so a menu drawn at a translated origin,
// at any size, anywhere on the screen reads the same as one drawn in stage
// coordinates. Nothing about the spacing between the two, their size, or their
// horizontal placement is asserted: `specs/ui.md` fixes none of it.
//
// WHAT IS NOT ASSERTED. Which entry is drawn as highlighted is
// `screens/title-menu-selection`'; what confirming each one opens is
// `screens/howto-reachable`' and `screens/start-enters-stage-intro`'.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertTrue, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  drawnTextSpans,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";
import { drawFrame, runCarrying, titleItems } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every title-menu entry, the mode entry above HOW TO PLAY", async () => {
  await h.advance(1);
  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "the game opens on the title screen (specs/ui.md)",
  );

  const items = titleItems(opened.mode);
  const calls = await drawFrame(h);
  captureStill(h, "menu");

  for (const item of items) {
    assertTrue(
      drewText(calls, item),
      `the title menu drawing the TITLE_ITEMS entry ${item} (specs/ui.md, ` +
        `specs/mode.md for the ${opened.mode} mode's own entry)`,
    );
  }

  const spans = drawnTextSpans(h);
  const mode = runCarrying(spans, items[0]);
  const howto = runCarrying(spans, items[1]);
  if (mode === undefined || howto === undefined) {
    fail(
      `both TITLE_ITEMS entries (${items.join(", ")}) drawn as runs of text ` +
        "whose anchors can be read (specs/ui.md)",
      JSON.stringify(drawnText(calls)),
    );
  }
  assertLessThan(
    mode.y,
    howto.y,
    `the ${items[0]} entry drawn above the ${items[1]} entry — TITLE_ITEMS is ` +
      "the mode entry then HOW TO PLAY, stacked one above the next, in that " +
      "order (specs/ui.md)",
  );
});
