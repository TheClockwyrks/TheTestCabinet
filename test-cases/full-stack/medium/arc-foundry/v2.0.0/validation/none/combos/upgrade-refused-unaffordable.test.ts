// combos/upgrade-refused-unaffordable — an upgrade that cannot be paid for does nothing.
//
// specs/combinations.md: upgrading "is refused at level `3` and when the player
// cannot afford the next level." specs/instrumentation.md fixes what a refusal
// looks like from outside: `upgradeCombo` commits through the panel's upgrade
// control, so it is refused wherever that control is, and "the refusal is
// readable in the snapshot: ... no Charge leaves the bank."
//
// The bank is posed one Charge short of the Static Web's first upgrade, which
// `27` makes `26`, and the upgrade is attempted anyway. The level and the bank
// are read back unchanged, and the panel's own control is read as disabled,
// because a control that still invites the press is the failure a player meets
// first. The neighbouring refusal, at the top of the track with the Charge to
// spare, is the sibling `upgrade-refused-at-max` check.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { comboDef, comboUpgradeCost } from "../constants";
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
/** One short of what reaching level 1 costs. */
const SHORT = comboUpgradeCost(TOWER.id, 1) - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the level and the bank alone when the next level cannot be paid for", async () => {
  await openYard(h, { charge: SHORT });
  const id = await standCombo(h, TOWER.id, ANCHOR.col, ANCHOR.row);
  await h.debug.select(id);

  await h.advance(1);
  await captureStill(h, "refused");

  const control = await panelControl(h, "upgrade");
  assertEqual(
    control.disabled,
    true,
    `the upgrade control with ${SHORT} Charge against a cost of ` +
      `${comboUpgradeCost(TOWER.id, 1)}`,
  );

  await h.debug.upgradeCombo(id);

  const s = await h.snapshot();
  assertEqual(
    structureById(s, id).level,
    0,
    "the refused upgrade raised no level",
  );
  assertEqual(s.charge, SHORT, "the refused upgrade spent no Charge");
});
