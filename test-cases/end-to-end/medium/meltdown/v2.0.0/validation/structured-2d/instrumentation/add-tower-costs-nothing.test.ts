// Meltdown — instrumentation/add-tower-costs-nothing: `addTower` spends no money
// and runs no placement check.
//
// `specs/instrumentation.md`: "`addTower(type, col, row, rotation)` — Adds one
// tower of `type` ... It costs nothing, spends nothing, and runs no placement
// check." That is what makes every posed floor in this suite reachable:
// `specs/building.md`'s fourth validity rule is "The current money is at least
// the held type's build cost", so a floor of Lances is a floor no purse in the
// game could pay for, and a build whose `addTower` went through the placement
// path would refuse to pose one.
//
// THE REFUSAL IS ESTABLISHED FIRST, AND ESTABLISHED AS THE MONEY'S. A reading
// that only showed the tower arriving would say nothing: the footprint might have
// been placeable all along. So the same footprint is armed and previewed twice
// over — once with exactly the build cost in the purse, where `build.valid` must
// be true, and once a single coin short, where it must be false. Everything else
// about the two readings is identical: same type, same tiles, same rotation, same
// floor, same phase. The only rule of `specs/building.md`'s six that can have
// changed between them is the fourth, so the refusal that follows is a refusal
// FOR WANT OF MONEY and not for any other reason.
//
// THEN `addTower` IS ASKED FOR THAT EXACT FOOTPRINT, and must build it anyway,
// with the purse still one coin short afterwards.
//
// THE TOWER IS A LANCE, whose `150` is the joint highest build cost
// `specs/towers.md` gives, so the gap between a purse that can pay and one that
// cannot is as wide as the game offers and no rounding could close it. Its
// footprint is `4x4`, the largest there is, so the anchor is one with room around
// it and clear of both corridors — a footprint that fails a rule other than the
// money would make the first half of the reading fail, which is what that half is
// there to catch.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { quietSite, readTower } from "./ground";

/** The type posed, and the build cost `specs/towers.md` gives it. */
const TYPE = "lance";
const COST = TOWER_DEFS[TYPE].cost;

/** The footprint both halves of the reading use. */
const SITE = quietSite(0);

/** What `build.valid` is read at, above the cost and below it by one coin. */
const CAN_PAY = COST;
const CANNOT_PAY = COST - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds on a footprint the placement check refuses for want of money, and spends nothing", async () => {
  startRun(h);
  assertGreaterThan(
    COST,
    1,
    "precondition: the type posed has a build cost to be short of",
  );

  // The same footprint, priced twice. The preview is re-posed after the purse
  // changes, so a build that decides validity at the moment the preview moves
  // and one that decides it at the read are held to the same rule.
  h.debug.setArmed(TYPE);
  h.debug.setPreviewRotation(0);

  h.debug.setMoney(CAN_PAY);
  h.debug.setPreview(SITE.col, SITE.row);
  const affordable = h.snapshot().build;
  assertNotNull(affordable, "the held preview, with the cost in the purse");
  assertEqual(
    affordable?.valid,
    true,
    `precondition: the footprint is placeable with ${CAN_PAY} in the purse, ` +
      "so nothing but the money can refuse it",
  );

  h.debug.setMoney(CANNOT_PAY);
  h.debug.setPreview(SITE.col, SITE.row);
  const unaffordable = h.snapshot().build;
  assertNotNull(unaffordable, "the held preview, one coin short");
  assertEqual(
    unaffordable?.valid,
    false,
    `the placement check with ${CANNOT_PAY} in the purse, one coin under the cost`,
  );

  // And the pose builds it regardless.
  h.debug.addTower(TYPE, SITE.col, SITE.row, 0);
  await h.advance(1);
  captureStill(h, "posed");
  const after = h.snapshot();

  assertLength(after.towers, 1, "the towers addTower left on the floor");
  const built = readTower(
    after,
    after.towers[0].id,
    "the tower addTower posed",
  );
  assertEqual(built.type, TYPE, "the type addTower built");
  assertEqual(built.col, SITE.col, "the column addTower built on");
  assertEqual(built.row, SITE.row, "the row addTower built on");
  assertEqual(
    after.money,
    CANNOT_PAY,
    "the money after addTower, which spends nothing",
  );
});
