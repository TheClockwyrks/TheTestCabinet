// pointer/title-click-confirms — a click inside `LIGHT THE LAMP`'s rectangle
// lights the lamp.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 2:
// "Click. A primary press edge inside the rectangle of the item at `menuIndex`
// `i` sets `menuIndex` to `i` ... and then takes that item exactly as `confirm`
// on it does." specs/ui.md ("`title`"): "`LIGHT THE LAMP` | Starts a fresh run,
// defined below, and sets `screen = playing`", over the menu `TITLE_ITEMS`,
// whose first item it is. specs/ui.md ("A fresh run") fixes what that run holds:
// "the run clock at `0:00`, the lamplighter at the world origin `(0, 0)` with
// `hp = BASE_MAX_HP` (`100`), `facing = "right"`, and `hurtFlash` at `0`, level
// `1` with `xp = 0` and `kills = 0`, Taper at level `1` alone in the first
// weapon slot and no passive held, no enemy, projectile, zone, gem, or pickup in
// the world, no level-up queued, and the spawn timer at `0`".
// specs/controls.md adds what the clicking frame itself does: "The frame's
// update then runs on the screen the edges left: a frame whose press enters
// `playing` ... runs that frame's ticks", so the run is read one tick old.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The whole documented run, field
// for field, against the fresh run the specification states, less the clock the
// clicking frame ticked, which is asserted on its own. A build that merely
// changed screens fails on the run; a build that started a run without entering
// `playing` fails on the screen.
//
// HOW THE SCENARIO IS DRIVEN. `menuRects()` reports where this build laid the
// three title items out, and the primary button is pressed at the MIDDLE of the
// FIRST rectangle, the item the title opens highlighted on, with exactly one
// frame between the press and the release: a press that ran no frame would never
// reach a build that reads its input once per frame, and the pointer rules are
// "applied on every frame, after that frame's press edges". No stage point is
// named by the check, because the specification fixes no layout.
//
// WHY EVERY DRIVER SWITCH IS OFF FIRST. The clicking frame is itself the run's
// first tick, and a tick with the game's faculties running spawns, fires, and
// drops as `specs/enemies.md` and `specs/weapons.md` state, none of which is
// what a fresh run holds. The seven switches "stay as they are" across a screen
// change (specs/instrumentation.md), so holding them all off leaves that first
// tick moving the clock alone, and the run the click began can be read field for
// field against the fresh run the specification states.
//
// THE TOLERANCE. None: a screen name, a tick count, and the fresh run's figures
// are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  documentedRun,
  FRESH_TAPER,
  holdAll,
  idleRun,
  type Harness,
} from "../harness";
import { menuPoints, poseTitle } from "./stage";

/** The item clicked: `LIGHT THE LAMP`, the first of `TITLE_ITEMS`. */
const CLICKED = TITLE_ITEMS.indexOf("LIGHT THE LAMP");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters playing on a fresh run when a click lands in LIGHT THE LAMP", async () => {
  await poseTitle(h);
  await holdAll(h);
  const points = await menuPoints(h, TITLE_ITEMS.length, "for the title menu");

  const started = await clickAt(h, points[CLICKED]!);
  await captureStill(h, "click");

  assertEqual(started.screen, "playing", "the screen the click left");
  assertDeepEqual(
    { ...documentedRun(started.run), tick: 0, time: 0 },
    idleRun([FRESH_TAPER]),
    "the run the click began, less the clock the clicking frame ticked",
  );
  assertEqual(
    started.run.tick,
    1,
    "the run clock after the frame that lit the lamp",
  );
});
