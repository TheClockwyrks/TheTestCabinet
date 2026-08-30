// building/upgrade-raises-the-level — an upgrade takes a tower one level up, twice.
//
// specs/building.md, Upgrading: "Upgrading raises the selected tower one level,
// from 1 to 2 and from 2 to 3."
//
// ONE LEVEL AT A TIME, AND BOTH STEPS ARE READ. A build that jumped straight to
// level III on the first upgrade, or that stopped after the first, reads a
// different level than the one due, and the failure names which step it was. What
// the level costs is `building/upgrade-costs`, what it changes is
// `building/upgrade-changes-the-stats`, and that it stops at three is
// `building/upgrade-stops-at-three`; this item is the level number alone.
//
// THE TOWER IS POSED WITH `poseTower`, the atom that costs nothing and runs no
// placement check (specs/instrumentation.md), so a tower on the floor is a
// precondition here rather than a thing being graded, and the purse is posed far
// above both upgrade costs so affordability is never what refuses a step —
// `building/upgrade-refused-when-unaffordable` is where that is decided.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";

/** The tower upgraded, on a quiet anchor. */
const HELD = "arc";
const AT = FREE_SITE;

/** Far above both upgrade costs, so affordability never refuses a step. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("raises the level one step at a time, from I to II to III", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);
  const id = await poseTower(h, HELD, AT.col, AT.row);

  assertEqual(
    requireTower(await h.snapshot(), id, "the posed tower").level,
    1,
    "the level a tower stands on the floor at",
  );

  await h.debug.upgradeTower(id);
  const second = requireTower(await h.snapshot(), id, "after one upgrade");

  await h.debug.upgradeTower(id);
  const third = requireTower(await h.snapshot(), id, "after two upgrades");

  await h.advance(1);
  await captureStill(h, "level");

  assertEqual(second.level, 2, "the level after one upgrade");
  assertEqual(third.level, 3, "the level after a second upgrade");
});
