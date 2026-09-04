// screens/chest-shows-level-result — the chest overlay shows a level as the
// item's icon, its name, and the level it became.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`chest`"), the result table:
// "`level` | The item's icon and name, and `LEVEL_LABEL` with the level it
// became." specs/evolutions.md ("Opening a chest"), rule 2, is what makes the
// result a level: "One held item below its max level ... rises by `1` ... The
// result is `{ kind: "level", item, level }`, with `level` the level it
// became." The item's name is the one specs/ui.md gives an offer: the weapon's
// from `WEAPON_NAMES` or the passive's from `PASSIVES`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night holding Taper at level `3`
// and Brass at level `1`: Taper is below `MAX_WEAPON_LEVEL` (`8`) so nothing
// can evolve, and both stand below their maxes so the level rule has an item to
// raise. WHICH of the two rises is drawn "uniformly at random" and the
// specification does not fix it, so the item and the level are read off
// `chestResult` and the frame is checked against what the build itself reported.
// The run's own level is the one `isolate` poses, far from either item's, so
// the experience bar's `LEVEL` label cannot be read as the result's.
//
// THE TOLERANCE. The name and the `LEVEL n` tag are matched folded, each looked
// for on the result's row within `ROW_BAND` (`110` units), and the icon counts
// as the result's on the same terms.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertOnRow,
  assertShows,
  chestResultOf,
  iconDraws,
  iconOnRow,
  levelTag,
  mustRowY,
  night,
  offerName,
  openLevelChest,
  rowsShowing,
  shown,
} from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the levelled item's name, its new level, and an icon on its row", async () => {
  await night(h);
  const opened = await openLevelChest(h);
  const result = chestResultOf(
    opened,
    "the chest opened over Taper 3 and Brass 1",
  );
  assertEqual(result.kind, "level", "the result's kind");
  if (result.kind !== "level") return;
  assertNotEqual(
    opened.run.level,
    result.level,
    "the run's own level, which the HUD draws under the same label",
  );

  const page = await shown(h);
  await captureStill(h, "level");

  const name = offerName(result.item);
  assertShows(page, name, "the chest overlay's level result");
  const row = mustRowY(page, name, "the levelled item's name");
  assertOnRow(
    rowsShowing(page, levelTag(result.level)),
    row,
    `the ${levelTag(result.level)} the chest overlay reports`,
  );
  assertNotNull(
    iconOnRow(iconDraws(page.calls), row) ?? null,
    `an icon-sized image drawn on the row of ${name}`,
  );
});
