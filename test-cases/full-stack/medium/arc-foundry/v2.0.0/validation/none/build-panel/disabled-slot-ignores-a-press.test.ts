// build-panel/disabled-slot-ignores-a-press — a disabled slot commits nothing.
//
// `specs/hud.md` fixes what the inspector does with an action the selection cannot
// use right now: it "is drawn disabled in its slot, visibly inert and ignoring
// clicks, rather than hidden, removed, or collapsed". `specs/controls.md` says the
// same from the action's side, "an action not listed as available on a screen does
// nothing there", and `specs/instrumentation.md` makes the reported rectangle the
// control's real hit region, so a press at its centre is the press a player makes.
//
// THE OTHER DIRECTION. `build-panel/slots-fixed` decides that an unavailable action
// is REPORTED disabled rather than dropped, and `input/pointer-activates-control`
// decides that a press at a reported, non-disabled rectangle activates its control.
// Neither presses a disabled one. This does, at the two slots whose refusal comes
// from a rule of its own rather than from the price of the act:
//
//   UPGRADE at a tower's top level. `specs/combinations.md` refuses an upgrade "at
//     level `3` and when the player cannot afford the next level", so with the bank
//     full the level alone is what disables the slot.
//   DISMANTLE during a wave. `specs/controls.md` offers `dismantle` "during a build
//     phase only", so the phase alone is what disables the slot, and nothing about
//     the structure itself would refuse the removal.
//
// One rule, read at the two points it could break, which is one validator rather
// than two. A build that hit-tests its rectangles without consulting `disabled`
// fails the second: the structure it was asked to leave alone comes off the yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { COMBO_MAX_LEVEL } from "../constants";
import {
  captureStill,
  clickControl,
  createHarness,
  holdWaveOpen,
  openYard,
  panelControl,
  standCombo,
  standComponent,
  structureAt,
  structureById,
  type Harness,
} from "../harness";

/** More Charge than either act here costs, so no refusal can be about the price. */
const PLENTY = 500;

/** The refinement level the first pose stands at, and must still stand at. */
const FROM = 0;

/** Anchors clear of the Substation's chain, entry and collector. */
const TOWER = { col: 14, row: 0 };
const STANDING = { col: 10, row: 0 };

/** A type that never fires, so the held-open wave kills nothing and pays nothing. */
const INERT_TYPE = "regulator";
const INERT_TIER = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("commits nothing when a disabled inspector slot is pressed", async () => {
  // The top rung. A tower at `COMBO_MAX_LEVEL` has nowhere left to climb, so its
  // UPGRADE slot is drawn disabled even with the bank full.
  await openYard(h, { refinement: FROM, charge: PLENTY });
  const tower = await standCombo(
    h,
    "fusecluster",
    TOWER.col,
    TOWER.row,
    COMBO_MAX_LEVEL,
  );
  await h.debug.select(tower);

  const upgrade = await panelControl(h, "upgrade");
  assertEqual(
    upgrade.disabled,
    true,
    `the UPGRADE slot on a tower at level ${COMBO_MAX_LEVEL} with ${PLENTY} ` +
      "Charge in the bank (specs/combinations.md)",
  );
  await clickControl(h, upgrade);

  const topped = await h.snapshot();
  assertEqual(
    structureById(topped, tower).level,
    COMBO_MAX_LEVEL,
    "the tower's level after a press on its disabled UPGRADE slot",
  );
  assertEqual(
    topped.charge,
    PLENTY,
    "the Charge after a press on a disabled slot, which spends nothing " +
      "(specs/hud.md)",
  );
  assertEqual(
    topped.refinement,
    FROM,
    "the refinement level after a press on the inspector's disabled UPGRADE " +
      "slot, which is not the press's refinement control (specs/hud.md)",
  );

  // A live wave. Dismantling is a build-phase action, so the slot on a standing
  // structure is drawn disabled for as long as the wave runs.
  await openYard(h, { charge: PLENTY });
  const standing = await standComponent(
    h,
    INERT_TYPE,
    INERT_TIER,
    STANDING.col,
    STANDING.row,
  );
  await holdWaveOpen(h);
  await h.debug.select(standing);
  assertEqual(
    (await h.snapshot()).phase,
    "wave",
    "the phase a released unit puts the run into (specs/instrumentation.md)",
  );

  const dismantle = await panelControl(h, "dismantle");
  assertEqual(
    dismantle.disabled,
    true,
    "the DISMANTLE slot on a standing structure during a wave " +
      "(specs/controls.md)",
  );
  const before = (await h.snapshot()).structures.length;
  await clickControl(h, dismantle);
  await captureStill(h, "inert");

  const left = await h.snapshot();
  assertEqual(
    left.structures.length,
    before,
    "the structures on the yard after a press on a disabled DISMANTLE slot",
  );
  assertEqual(
    structureAt(left, STANDING.col, STANDING.row)?.id ?? null,
    standing,
    `the structure still anchored at (${STANDING.col}, ${STANDING.row}): a ` +
      "disabled slot ignores a press (specs/hud.md)",
  );
});
