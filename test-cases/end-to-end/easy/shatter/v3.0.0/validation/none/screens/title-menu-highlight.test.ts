// Shatter — screens/title-menu-highlight: the entry `menuIndex` names is drawn
// differently from the other, and the difference moves when `menuIndex` does.
//
// THE RULE. `specs/ui.md`, on the `title` screen: "the highlighted entry is drawn
// distinctly from the others, so a player always sees which entry confirming would
// take". `specs/instrumentation.md` reports the highlight as `menuIndex` and poses it
// with `setMenuIndex(n)`, so the rule has an observable form: move the highlight from
// the first entry to the second and BOTH entries must be drawn differently than they
// were — the one that lost it and the one that gained it.
//
// WHY BOTH ENTRIES, AND NOT JUST ONE. Requiring only that something on the screen
// changed would pass a build that draws a fixed ornament on the first entry whatever
// `menuIndex` says, since the ornament is there in one reading and gone in the
// other. Requiring the change on the entry that GAINED the highlight as well is what
// makes the reading "the difference moved" rather than "something changed", and a
// build that draws its two entries identically fails both halves.
//
// NOTHING HERE SAYS HOW A BUILD MUST DISTINGUISH AN ENTRY. `specs/ui.md` fixes no
// palette, no typeface, no marker and no layout, so the check compares the build
// against ITSELF: the same band of canvas, measured once and read twice. A build
// that recolours the entry, draws it larger, boxes it or sets a caret beside it moves
// the same reading, and the band reaches `MARKER_MARGIN` past the entry's glyphs so a
// marker drawn beside the word counts as the word being drawn distinctly
// (`./menu.ts`).
//
// THE BAND IS MEASURED ONCE. Both readings use the band the FIRST frame's runs gave,
// so a build that moves or grows the highlighted entry is read over the same piece of
// canvas in both — which is the change, not a reason to look somewhere else.
//
// A LIMIT, STATED HONESTLY. A build that animates its menu entries frame to frame
// would move this reading without highlighting anything. No look-agnostic reading can
// separate the two, and the specification asks for a distinction rather than for
// stillness, so the check does not pretend to: what it does exclude is the build that
// draws every entry the same way, which is the fault the item exists for.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the entries are drawn at all, or in order
// (`screens/title-menu-entries`); that a KEY moves the highlight
// (`controls/menu-down-arrow` and its three siblings); or that `setMenuIndex` reads
// back (`instrumentation/menu-index`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  BAND_SAMPLES,
  bandOf,
  changedSamples,
  menuDraws,
  readBand,
} from "./menu";
import { reachTitle } from "./screens";

/** The entry the highlight is posed on first: the one arriving at the title rests on. */
const FIRST_ENTRY = 0;
/** The entry it is moved to. */
const SECOND_ENTRY = 1;

/**
 * How many of an entry's 615 band samples must change when the highlight moves.
 *
 * About one percent of the band, which is the smallest mark that reads as a
 * distinction at the logical field size: a caret of a dozen units by twenty, drawn
 * beside a menu entry, covers this many samples several times over, and a recoloured
 * or reweighted run covers it by a wide margin. It is a floor rather than a
 * measurement of any particular look — two renders of one state are identical, so a
 * build that draws its entries the same way whatever `menuIndex` holds reads exactly
 * `0` here.
 */
const MIN_CHANGED = Math.ceil(BAND_SAMPLES * 0.01);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the highlighted title entry apart from the other, and moves the difference with menuIndex", async () => {
  assertEqual(
    TITLE_ITEMS.length,
    2,
    "the title menu entries specs/ui.md fixes, which this item's pair rests on",
  );

  await reachTitle(h);

  // The bands, measured once off the frame the first reading is taken on.
  await h.debug.setMenuIndex(FIRST_ENTRY);
  assertEqual(
    (await h.snapshot()).menuIndex,
    FIRST_ENTRY,
    "the entry the highlight was posed on",
  );
  const drawn = menuDraws(
    await h.presentCalls(),
    TITLE_ITEMS,
    "the title screen",
  );
  const bands = drawn.map((draw) =>
    bandOf(
      draw,
      drawn.filter((other) => other !== draw),
    ),
  );
  const before = [await readBand(h, bands[0]), await readBand(h, bands[1])];

  await h.debug.setMenuIndex(SECOND_ENTRY);
  assertEqual(
    (await h.snapshot()).menuIndex,
    SECOND_ENTRY,
    "the entry the highlight was moved to",
  );
  const after = [await readBand(h, bands[0]), await readBand(h, bands[1])];
  await captureStill(h, "highlight");

  assertGreaterThanOrEqual(
    changedSamples(before[0], after[0]),
    MIN_CHANGED,
    `samples of "${TITLE_ITEMS[0]}" redrawn when the highlight left it, of ${BAND_SAMPLES} (specs/ui.md)`,
  );
  assertGreaterThanOrEqual(
    changedSamples(before[1], after[1]),
    MIN_CHANGED,
    `samples of "${TITLE_ITEMS[1]}" redrawn when the highlight reached it, of ${BAND_SAMPLES} (specs/ui.md)`,
  );
});
