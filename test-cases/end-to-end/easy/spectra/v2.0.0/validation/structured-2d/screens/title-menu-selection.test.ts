// Spectra — screens/title-menu-selection: the drawn highlight follows the index.
//
// THE RULE. `specs/ui.md`: "The highlighted item is the one the menu index names,
// counted from `0`, and it is drawn distinctly from the others, so a player always
// sees which item `confirm` would take." `menuIndex` is posed directly, which is what
// `specs/instrumentation.md` provides `setMenuIndex` for, so the menu keys — whose own
// points are `controls/menu-up-*` and `controls/menu-down-*` — cannot fail this one.
//
// WHAT IS MEASURED, AND WHY IT IS MEASURED THAT WAY. `specs/ui.md` fixes no palette,
// no type and no layout for the menu, and it does not say WHAT a highlight looks like
// — a colour, a marker, a bar behind the words, a larger face are all conformant. So
// nothing here may assert an appearance. What it asserts instead is the pixels: with
// the index on the first item and again with it on the second, the neighbourhood of
// EACH entry must have been repainted. An entry whose drawing is the same at both
// indices was not drawn distinctly at either, which is exactly the failure
// `specs/ui.md` forbids, and both entries are read because a build that repaints only
// the one it happens to start on has a highlight that does not follow the index.
//
// EACH ENTRY'S NEIGHBOURHOOD IS THE BUILD'S OWN, AND THE BUILD REPORTS IT. It is the
// hit region `menuItemRect(index)` returns for that item — the region `specs/ui.md`
// says a pointer or a contact selects the item from, in logical units. So a menu
// drawn anywhere at any size is read where the build put it, and a build whose labels
// are a sprite or a bitmap-font atlas rather than drawn text is read exactly as well
// as one that draws them with the engine's text call. Two items' regions select
// different items, so they do not overlap and the change read in one cannot be the
// other entry's.
//
// THE CONTROL. A strip of screen that moves on its own — an animated menu, a drifting
// starfield behind it — would let "something changed" pass a build whose highlight
// never moved, so each neighbourhood's own frame-to-frame drift is measured first,
// with nothing posed between the two readings, and the change the index causes has to
// beat it.
//
// WHAT THIS DOES NOT DECIDE, AND SAYS SO. Which of the two treatments is the
// HIGHLIGHTED one. Reading the regions from the build's own report settles WHERE to
// look; it does not settle what a highlight looks like. With two entries and no fixed
// appearance for one, no reading of the pixels can tell "the highlight is on the item
// the index names" from "the highlight is on the other one" — a script would have to
// be told what a highlight looks like, which `specs/ui.md` deliberately does not say.
// The capture is what a reviewer decides that from.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  menuRect,
  type Harness,
} from "../harness";
import {
  PAINT_MIN,
  countMoved,
  driftOverOneFrame,
  readRegion,
  titleItems,
} from "./reading";

/** The two indices the highlight is posed at: every index TITLE_ITEMS has. */
const FIRST_INDEX = 0;
const SECOND_INDEX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("repaints each title-menu entry when the highlight index moves to it", async () => {
  await h.advance(1);
  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "the game opens on the title screen (specs/ui.md)",
  );
  assertEqual(
    opened.menuIndex,
    FIRST_INDEX,
    "with the highlight resting on the first item (specs/ui.md)",
  );

  // Where the build itself put each entry, asked of the build, so the squares
  // read below are its own layout rather than the case's.
  const items = titleItems(opened.mode);
  const firstBox = menuRect(h, FIRST_INDEX);
  const secondBox = menuRect(h, SECOND_INDEX);

  // What each square does on its own across one frame, with nothing posed.
  const firstDrift = await driftOverOneFrame(h, firstBox, PAINT_MIN);
  const secondAtFirstIndex = readRegion(h, secondBox);
  const secondDrift = await driftOverOneFrame(h, secondBox, PAINT_MIN);
  const firstAtFirstIndex = readRegion(h, firstBox);

  h.debug.setMenuIndex(SECOND_INDEX);
  await h.advance(1);
  assertEqual(
    h.snapshot().menuIndex,
    SECOND_INDEX,
    "the highlight index moved to the second item (specs/instrumentation.md)",
  );
  const firstAtSecondIndex = readRegion(h, firstBox);
  const secondAtSecondIndex = readRegion(h, secondBox);
  captureStill(h, "highlight");

  assertGreaterThan(
    countMoved(firstAtFirstIndex, firstAtSecondIndex, PAINT_MIN),
    firstDrift.count,
    `pixels of the ${items[0]} entry redrawn once the index no longer names ` +
      "it — the highlighted item is the one menuIndex names and is drawn " +
      "distinctly from the others (specs/ui.md); its square moved on its own " +
      `across one frame in ${String(firstDrift.count)} pixels`,
  );
  assertGreaterThan(
    countMoved(secondAtFirstIndex, secondAtSecondIndex, PAINT_MIN),
    secondDrift.count,
    `pixels of the ${items[1]} entry redrawn once the index names it — the ` +
      "highlighted item is the one menuIndex names and is drawn distinctly " +
      "from the others (specs/ui.md); its square moved on its own across one " +
      `frame in ${String(secondDrift.count)} pixels`,
  );
});
