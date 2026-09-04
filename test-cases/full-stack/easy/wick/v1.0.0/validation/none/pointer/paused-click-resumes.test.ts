// pointer/paused-click-resumes — a click inside `RESUME`'s rectangle gives the
// held run back.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 2: "A
// primary press edge inside the rectangle of the item at `menuIndex` `i` sets
// `menuIndex` to `i` ... and then takes that item exactly as `confirm` on it
// does." specs/ui.md ("`paused`"): "`RESUME` | Sets `screen = playing`, with the
// run untouched", the first item of `PAUSE_ITEMS`. specs/ui.md ("What advances
// on each screen"): while `paused`, "Nothing. The world beneath holds exactly
// the tick it was at", so the run the resume gives back is the run the pause
// took. specs/controls.md adds what the resuming frame itself does: "The frame's
// update then runs on the screen the edges left: a frame whose press enters
// `playing`, from the title, an end screen, `paused`, or an overlay, runs that
// frame's ticks", so the run is read one tick past the pause and the clock is
// asserted on its own.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The whole documented run, field
// for field, against the reading taken while it was paused, less the clock the
// resuming frame ticked. A build that resumed by starting a fresh run rather
// than by giving the held one back fails on every posed figure at once.
//
// HOW THE WORLD IS POSED. The night is isolated and then given a clock, a level,
// experience, kills, a health short of full, a lamplighter off the origin, and a
// loadout, because "the run untouched" is only visible against a run that has
// something in it. Every driver switch is off, so the one tick the resuming
// frame runs moves the clock and nothing else, and anything else that changed
// came from the resume. The pause itself is posed through `setScreen("paused")`,
// which specs/instrumentation.md defines as setting `screen` and nothing else.
//
// HOW THE GESTURE IS POSED. `menuRects()` reports where this build drew the two
// pause items, and the primary button is pressed at the middle of the FIRST,
// `RESUME`, with exactly one frame between press and release.
//
// THE TOLERANCE. None: the documented run is compared field for field, and a
// screen name and a tick count are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  documentedRun,
  holdPassive,
  holdWeapon,
  type Harness,
} from "../harness";
import { menuPoints, night, posePaused } from "./stage";

/** The item the click lands in: `RESUME`, the first of `PAUSE_ITEMS`. */
const CLICKED = PAUSE_ITEMS.indexOf("RESUME");

/** Figures the held night carries, none of them a fresh run's. */
const POSED = {
  tick: 4500,
  level: 7,
  xp: 12,
  kills: 250,
  hp: 77,
  x: 300,
  y: -120,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads playing with the run exactly as the pause held it", async () => {
  await night(h);
  await holdWeapon(h, "ember", 3);
  await holdPassive(h, "brass", 2);
  await h.debug.setTick(POSED.tick);
  await h.debug.setLevel(POSED.level);
  await h.debug.setXp(POSED.xp);
  await h.debug.setKills(POSED.kills);
  await h.debug.setHp(POSED.hp);
  await h.debug.setPlayerPosition(POSED.x, POSED.y);
  const held = await posePaused(h);
  const points = await menuPoints(h, PAUSE_ITEMS.length, "for the pause menu");

  const resumed = await clickAt(h, points[CLICKED]!);
  await captureStill(h, "resumed");

  assertEqual(resumed.screen, "playing", "the screen the click left");
  assertDeepEqual(
    {
      ...documentedRun(resumed.run),
      tick: held.run.tick,
      time: held.run.time,
    },
    documentedRun(held.run),
    "the run the resume gives back, less the clock the resuming frame ticked",
  );
  assertEqual(
    resumed.run.tick,
    held.run.tick + 1,
    "the run clock on the frame that resumed",
  );
});
