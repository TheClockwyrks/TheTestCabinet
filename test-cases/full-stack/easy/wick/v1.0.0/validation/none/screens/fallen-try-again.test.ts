// screens/fallen-try-again — `TRY AGAIN` on the fallen screen starts a fresh
// run.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`fallen` and `dawn`"):
// "`confirm` takes the highlighted item: `TRY AGAIN` starts a fresh run and
// sets `screen = playing`", over "Menu | `END_ITEMS`: `TRY AGAIN`, `TITLE`, in
// that order" with "`menuIndex` is `0` on arriving", so the highlighted item on
// arrival is `TRY AGAIN`. specs/ui.md ("A fresh run") fixes what it starts:
// "`LIGHT THE LAMP`, `TRY AGAIN`, and the debug surface's
// `setScreen("playing")` each begin a fresh run, and whatever the previous run
// held is discarded", the idle run with "Taper at level `1` alone in the first
// weapon slot". specs/controls.md adds what the confirming frame does: "a frame
// whose press enters `playing` ... runs that frame's ticks", so the run is read
// one tick old.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night given a level, experience,
// kills, a loadout, a queued level-up, an enemy, a gem and a pickup, and then
// ended at fallen: specs/world.md ("Fallen and dawn") ends a run fallen when "`hp` is `0` or
// below" at the end of a tick, which this reaches through the health posed to `0` through `setHp`, whose "value at or below
// `0` ends the run fallen at the end of the next `playing` tick"
// (specs/instrumentation.md), and the tick that ends it. The previous run
// has to hold something for "a fresh run" to mean anything. Every driver switch
// is off, so nothing the first tick of the new run does could put an entity
// back. The press is a REAL `Enter` held across exactly one frame.
//
// THE TOLERANCE. None: the whole documented run is compared against the fresh
// run field for field, less the clock the confirming frame ticked, which is
// asserted on its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { END_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  documentedRun,
  FRESH_TAPER,
  holdPassive,
  holdWeapon,
  idleRun,
  placeEnemy,
  placeGem,
  placePickup,
  pressConfirm,
  type Harness,
} from "../harness";
import { endFallen, night } from "./stage";

/** Figures the ended run holds, none of them a fresh run's. */
const POSED = { level: 7, xp: 12, kills: 250, pending: 2 };

/** The index of `TRY AGAIN`, the item a run ends highlighted on. */
const TRY_AGAIN = END_ITEMS.indexOf("TRY AGAIN");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("begins a fresh run when Enter takes TRY AGAIN on fallen", async () => {
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
  const ended = await endFallen(h);
  assertEqual(ended.menuIndex, TRY_AGAIN, "the highlighted item, TRY AGAIN");
  assertEqual(ended.run.kills, POSED.kills, "the kills the ended run holds");

  const fresh = await pressConfirm(h);
  await captureStill(h, "again");

  assertEqual(fresh.screen, "playing", "the screen TRY AGAIN left");
  assertDeepEqual(
    { ...documentedRun(fresh.run), tick: 0, time: 0 },
    idleRun([FRESH_TAPER]),
    "the run TRY AGAIN begins, less the clock the confirming frame ticked",
  );
  assertEqual(
    fresh.run.tick,
    1,
    "the run clock after the frame that restarted",
  );
});
