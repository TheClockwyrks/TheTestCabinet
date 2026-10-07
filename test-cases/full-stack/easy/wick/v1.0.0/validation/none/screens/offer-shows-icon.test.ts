// screens/offer-shows-icon — each offer on the overlay draws its item's
// produced icon.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"), the offer table:
// "Icon | The item's produced icon." specs/assets.md fixes what a produced icon
// is: an icon canvas of `ICON_SIZE` (`24 x 24`), one per offerable id, and a
// produced file is "scaled in code to the live shape", so the size an icon
// lands at on the stage says nothing about it while the SOURCE it is taken from
// says everything: a build that draws each icon file draws the whole of a
// `24 x 24` image, and a build that packs its icons into one sheet takes a
// `24 x 24` rectangle out of it. Three offers are three different items, so the
// three icons are three different sources.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with an EMPTY loadout, so
// the HUD's twelve slots hold no icon and the world holds no gem, pickup or
// enemy: on that frame the only icon-sized sources drawn are the offers' own.
// The three offers are queued through `setNextOffers`, and each icon is matched
// to the row its name was drawn on rather than to the list as a whole, so a
// build that drew one icon three times, or drew them all beside one row, fails.
//
// THE TOLERANCE. A source rectangle is allowed to miss `24 x 24` by a pixel on
// either side, and an icon counts as an entry's when it lands within `ROW_BAND`
// (`110` units) of that entry's name and nearer to it than to any other
// entry's, which is the case's allowance for a layout the specification does
// not fix.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertDistinctIcons,
  iconDraws,
  iconOnRow,
  mustRowY,
  night,
  offerName,
  openOffers,
  shown,
} from "./stage";

/** Three candidates of an empty loadout's pool, in the order they are offered. */
const OFFERS = ["ember", "pin", "wick"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws one distinct icon-sized source on each of the three offers' rows", async () => {
  await night(h);
  const opened = await openOffers(h, OFFERS);
  assertEqual(opened.screen, "levelup", "the screen the frame is read on");

  const page = await shown(h);
  await captureStill(h, "icons");
  const rows = OFFERS.map((id) =>
    mustRowY(page, offerName(id), `the offer ${id}`),
  );
  const icons = iconDraws(page.calls);

  const found = rows.map((row, i) => {
    const others = rows.filter((_, j) => j !== i);
    const icon = iconOnRow(icons, row, others);
    assertNotNull(
      icon ?? null,
      `an icon-sized image drawn on the row of the offer ${OFFERS[i]}`,
    );
    return icon!;
  });
  assertDistinctIcons(found, "the three offers' icons");
});
