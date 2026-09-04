// Wick — screens/levelup-lists-offers: the overlay lists its offers down the
// screen in the order of `offers`, with the highlighted one drawn differently
// from the others.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`": the
// overlay "shows `LEVEL_UP_TEXT` ... and the offers in `offers`, listed
// vertically in that order". `specs/ui.md`, Presentation: "On every menu the
// item at `menuIndex` is drawn distinctly from the others, so a player always
// sees which item `confirm` would accept."
//
// WHAT IS READ, AND WHY. Where the frame drew each offer's NAME, which
// `specs/ui.md` fixes as the weapon's from `WEAPON_NAMES` or the passive's
// from `PASSIVES` — three anchors that must descend in the order `offers`
// lists. Then the pixels of the first two offers' own rows, on the frame with
// the first highlighted and on the frame with the second highlighted: a
// highlight that moves changes BOTH rows, the one it left and the one it
// reached. How the highlight looks is the build's, so nothing but "these rows
// are not the same picture" is read of it.
//
// THE DRIVE. An isolated `playing` world with every driver switch off and
// nothing held, three offers queued by name through `setNextOffers` — which
// `specs/instrumentation.md` says "the overlay then presents exactly that list
// in that order", and every one of the three is a candidate of the pool over
// an empty loadout — and the one `playing` tick that opens the overlay. The
// highlight is moved with one real `ArrowDown`.
//
// THE TOLERANCE. The order is strict: each anchor is strictly below the one
// before it. A row counts as redrawn at `MOVED_PIXELS` differing pixels,
// enough that a stray pixel of anti-aliasing is not mistaken for a highlight.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertNotNull,
} from "../assert";
import {
  PASSIVES,
  PIXEL_CHANNEL_EPS,
  WEAPON_NAMES,
  type OfferId,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  pixelsDiffering,
  tap,
  textDraws,
  type Harness,
} from "../harness";
import { anchorY, bandAt } from "./stage";

/** Three candidates of the pool over an empty loadout, in the order offered. */
const OFFERS: readonly OfferId[] = ["ember", "tallow", "lure"];

/** The display name each of them is listed under (specs/ui.md, levelup). */
const NAMES: readonly string[] = [
  WEAPON_NAMES.ember,
  PASSIVES.tallow.name,
  PASSIVES.lure.name,
];

/** How many pixels of a row must change for the highlight to have moved. */
const MOVED_PIXELS = 32;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lists the offers top to bottom and redraws the rows the highlight moves between", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the frame is read on");
  assertDeepEqual(
    overlay.run.offers,
    OFFERS,
    "the offers the overlay presents",
  );
  assertEqual(overlay.menuIndex, 0, "the highlighted offer on opening");

  const first = await h.frameDraw();
  captureStill(h, "offers");
  const draws = textDraws(first.calls);
  const anchors = NAMES.map((name) => anchorY(draws, name));
  for (const [index, at] of anchors.entries()) {
    assertNotNull(at, `where offer ${index}, ${NAMES[index]}, was drawn`);
  }
  for (let index = 1; index < anchors.length; index += 1) {
    assertLessThan(
      anchors[index - 1] as number,
      anchors[index] as number,
      `${NAMES[index - 1]} listed above ${NAMES[index]}, in device pixels down the stage`,
    );
  }

  const rows = anchors.map((at) => bandAt(h, at as number));
  const moved = await tap(h, "ArrowDown");
  assertEqual(moved.menuIndex, 1, "the highlighted offer after ArrowDown");
  await h.frameDraw();

  for (const index of [0, 1]) {
    assertGreaterThan(
      pixelsDiffering(
        rows[index],
        bandAt(h, anchors[index] as number),
        PIXEL_CHANNEL_EPS,
      ),
      MOVED_PIXELS,
      `pixels of offer ${index}'s row that changed when the highlight moved off or onto it`,
    );
  }
});
