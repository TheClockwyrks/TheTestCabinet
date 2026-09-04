// combos/upgrade-refused-at-max — the top of the track is the end of the track.
//
// specs/combinations.md: a combination tower carries "an upgrade level ... on the
// four-rung track `0` through `COMBO_MAX_LEVEL` (`3`)", and upgrading "is refused
// at level `3`". A refusal spends nothing, which specs/instrumentation.md states
// as the readable form of every refusal: "no Charge leaves the bank."
//
// The tower is posed at the top of its track with a bank far past any cost, so
// the only reason the upgrade can be refused is the one this check is about, and
// the level and the bank are read back unchanged. The panel's control is read as
// disabled beside them, because a live control at the top of the track is what a
// player would press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { COMBO_MAX_LEVEL, comboDef } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  panelControl,
  standCombo,
  structureById,
  type Harness,
} from "../harness";

const TOWER = comboDef("staticweb");
const ANCHOR = { col: 10, row: 10 };
/** Far past the `95` a third level would have cost, so want of Charge is not the reason. */
const BANK = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the level and the bank alone at COMBO_MAX_LEVEL", async () => {
  await openYard(h, { charge: BANK });
  const id = await standCombo(
    h,
    TOWER.id,
    ANCHOR.col,
    ANCHOR.row,
    COMBO_MAX_LEVEL,
  );
  await h.debug.select(id);

  await h.advance(1);
  await captureStill(h, "refused");

  const control = await panelControl(h, "upgrade");
  assertEqual(
    control.disabled,
    true,
    `the upgrade control at level ${COMBO_MAX_LEVEL} with ${BANK} Charge`,
  );

  await h.debug.upgradeCombo(id);

  const s = await h.snapshot();
  assertEqual(
    structureById(s, id).level,
    COMBO_MAX_LEVEL,
    "the refused upgrade raised no level",
  );
  assertEqual(s.charge, BANK, "the refused upgrade spent no Charge");
});
