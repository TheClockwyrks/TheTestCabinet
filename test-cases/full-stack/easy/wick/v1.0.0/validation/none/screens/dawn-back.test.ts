// screens/dawn-back — `back` on the dawn screen returns to the title with
// the idle run.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`fallen` and `dawn`"): "`back`
// does what `TITLE` does", and `TITLE` "returns to `title` with
// `menuIndex = 0`". specs/controls.md ("What each screen reads"), the `fallen`,
// `dawn` row: "`back` returns to `title`". specs/state.md fixes what the title
// then holds: "Off the run, on `title` and `howto`, the run's fields hold their
// idle values: tick `0`, level `1`, no experience, no kills, the lamplighter at
// the world origin facing right with `BASE_MAX_HP` (`100`) health, no weapons,
// no passives, nothing alive, nothing dropped, no offers, no level-ups earned,
// no chest result, the spawn timer at `0`, no events fired, and the next id
// `0`", which `idleRun()` restates.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night given a level, experience,
// kills, a loadout, a queued level-up, an enemy, a gem and a pickup, and then
// ended at dawn: specs/world.md ("Fallen and dawn") ends a run at dawn when "`tick` equals
// `DAWN_TIME x TICK_HZ` (`36000`)" at the end of a tick, which this reaches through the clock posed to `MAX_POSED_TICK` (`35999`), the greatest `setTick`
// accepts, and the tick that reaches `36000`. The run has to
// hold something for "does what `TITLE` does" to be told from "changes the
// screen". No menu key is pressed on the way, so the press is read against the
// screen as it is arrived at, and it is a REAL `Escape` held across exactly one
// frame.
//
// THE TOLERANCE. None: a screen name, an index, and the idle run's figures are
// exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  holdPassive,
  holdWeapon,
  idleRun,
  placeEnemy,
  placeGem,
  placePickup,
  pressBack,
  type Harness,
} from "../harness";
import { endDawn, night } from "./stage";

/** Figures the ended run holds, none of them the idle run's. */
const POSED = { level: 7, xp: 12, kills: 250, pending: 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with the idle run after Escape on dawn", async () => {
  await night(h);
  await holdWeapon(h, "ember", 3);
  await holdPassive(h, "brass", 2);
  await h.debug.setLevel(POSED.level);
  await h.debug.setXp(POSED.xp);
  await h.debug.setKills(POSED.kills);
  await h.debug.setPendingLevelUps(POSED.pending);
  await placeEnemy(h, "moth", 200, 0);
  await placeGem(h, "medium", -100, 0);
  await placePickup(h, "bread", 0, -100);
  const ended = await endDawn(h);
  assertEqual(ended.run.kills, POSED.kills, "the kills the ended run holds");

  const title = await pressBack(h);
  await captureStill(h, "back");

  assertEqual(title.screen, "title", "the screen Escape left");
  assertEqual(title.menuIndex, 0, "menuIndex on arriving at the title");
  assertDeepEqual(
    documentedRun(title.run),
    idleRun(),
    "the run the title holds once the ended run is discarded",
  );
});
