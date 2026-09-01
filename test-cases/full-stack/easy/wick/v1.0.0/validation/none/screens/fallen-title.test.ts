// screens/fallen-title — `TITLE` on the fallen screen returns to the title
// with the idle run.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`fallen` and `dawn`"):
// "`confirm` takes the highlighted item ... and `TITLE` returns to `title` with
// `menuIndex = 0`", over "Menu | `END_ITEMS`: `TRY AGAIN`, `TITLE`, in that
// order". specs/state.md fixes what the title then holds: "Off the run, on
// `title` and `howto`, the run's fields hold their idle values: tick `0`, level
// `1`, no experience, no kills, the lamplighter at the world origin facing
// right with `BASE_MAX_HP` (`100`) health, no weapons, no passives, nothing
// alive, nothing dropped, no offers, no level-ups earned, no chest result, the
// spawn timer at `0`, no events fired, and the next id `0`", which `idleRun()`
// restates; specs/instrumentation.md says the same of the transition:
// `setScreen("title")` "Discards the run exactly as `TITLE` on an end screen or
// `back` on `paused` does: the idle run."
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night given a level, experience,
// kills, a loadout, a queued level-up, an enemy, a gem and a pickup, and then
// ended at fallen: specs/world.md ("Fallen and dawn") ends a run fallen when "`hp` is `0` or
// below" at the end of a tick, which this reaches through the health posed to `0` through `setHp`, whose "value at or below
// `0` ends the run fallen at the end of the next `playing` tick"
// (specs/instrumentation.md), and the tick that ends it. The run has to
// hold something for "discards" to be visible. The surface carries no pose for
// `menuIndex`, so `TITLE` is highlighted with one `ArrowDown` from the `0` the
// screen is arrived on, read back before the confirm. Both presses are REAL
// keys held across exactly one frame.
//
// THE TOLERANCE. None: a screen name, an index, and the idle run's figures are
// exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { END_ITEMS } from "../constants";
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
  pressConfirm,
  pressDown,
  type Harness,
} from "../harness";
import { endFallen, night } from "./stage";

/** Figures the ended run holds, none of them the idle run's. */
const POSED = { level: 7, xp: 12, kills: 250, pending: 2 };

/** The index of `TITLE` in `END_ITEMS`. */
const TITLE = END_ITEMS.indexOf("TITLE");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with the idle run when Enter takes TITLE on fallen", async () => {
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
  let posed = ended;
  for (let i = 0; i < TITLE; i += 1) posed = await pressDown(h);
  assertEqual(posed.menuIndex, TITLE, "the highlighted item, TITLE");

  const title = await pressConfirm(h);
  await captureStill(h, "title");

  assertEqual(title.screen, "title", "the screen TITLE left");
  assertEqual(title.menuIndex, 0, "menuIndex on arriving at the title");
  assertDeepEqual(
    documentedRun(title.run),
    idleRun(),
    "the run the title holds once the ended run is discarded",
  );
});
