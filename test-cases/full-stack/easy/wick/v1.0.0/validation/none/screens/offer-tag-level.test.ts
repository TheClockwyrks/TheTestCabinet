// screens/offer-tag-level — an offer for a held item is tagged with the level
// it would become.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"), the offer table:
// "Tag | `OFFER_NEW_TEXT` (`NEW`) for an item not yet held, else `LEVEL_LABEL`
// and the level it would become, as `LEVEL 3`." specs/progression.md
// ("Choosing") states the same, and its acceptance table fixes what "would
// become" means: for "A held weapon or passive ... Its level rises by `1`". So
// Taper held at level `3` is offered as `LEVEL 4`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night holding Taper alone at
// level `3`, which is below `MAX_WEAPON_LEVEL` (`8`) and so a candidate of the
// pool, and one offer queued through `setNextOffers` so the overlay presents
// that item and nothing else. The run's own level is the one `isolate` poses,
// far from the tag's, so the experience bar's `LEVEL` label cannot be read as
// the tag. The tag is looked for on the offer's own row.
//
// THE TOLERANCE. The tag is matched folded, so a build that spaces or styles it
// passes, and it counts as the offer's when it lands within `ROW_BAND` (`110`
// units) of the offer's name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  type Harness,
} from "../harness";
import {
  assertOnRow,
  levelTag,
  mustRowY,
  night,
  offerName,
  openOffers,
  rowsShowing,
  shown,
} from "./stage";

/** Taper's held level, below `MAX_WEAPON_LEVEL` so it is a candidate. */
const TAPER_LEVEL = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("tags an offer for Taper held at level 3 as LEVEL 4", async () => {
  await night(h);
  await holdWeapon(h, "taper", TAPER_LEVEL);
  const opened = await openOffers(h, ["taper"]);
  assertEqual(
    (opened.run.weapons ?? [])[0]?.level,
    TAPER_LEVEL,
    "Taper's level when the offer was drawn",
  );
  assertEqual(
    TAPER_LEVEL < MAX_WEAPON_LEVEL,
    true,
    "Taper posed below its max level, so the offer is a level rather than a new item",
  );
  assertNotEqual(
    opened.run.level,
    TAPER_LEVEL + 1,
    "the run's own level, which the HUD draws under the same label",
  );

  const page = await shown(h);
  await captureStill(h, "level");

  const row = mustRowY(page, offerName("taper"), "the offer taper");
  assertOnRow(
    rowsShowing(page, levelTag(TAPER_LEVEL + 1)),
    row,
    `the ${levelTag(TAPER_LEVEL + 1)} tag of the offer taper`,
  );
});
