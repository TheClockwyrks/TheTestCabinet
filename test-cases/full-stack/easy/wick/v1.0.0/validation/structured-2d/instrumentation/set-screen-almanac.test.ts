// Wick — instrumentation/set-screen-almanac: `setScreen('almanac')` enters the
// almanac with the idle run and `menuIndex`, `almanacTab`, and `almanacScroll`
// all `0`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `almanac` from any: "Enters the almanac exactly as
// confirming `THE ALMANAC` does: the idle run, `menuIndex` `0`, `almanacTab`
// `0`, `almanacScroll` `0`." `specs/state.md`, "The idle run", is the table
// `IDLE_RUN` transcribes.
//
// WHAT IS READ, AND WHY. The screen, the three indices, and the whole run,
// compared field by field against the idle run. The row says "from any", so
// the call is made twice: once from a `playing` run disturbed enough that a
// kept run is told from a discarded one, and once from the almanac itself with
// the tab turned and the list scrolled, which is the only state the two
// almanac indices can be off `0` in.
//
// THE DRIVE. An isolated run with kills, a moved lamplighter, an enemy and a
// gem on the field, then the call. Then `right` and `down` presses on the
// almanac the call reached, which carry all three indices off `0`, and the
// call again.
//
// THE TOLERANCE. None: three whole indices and an exact run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  IDLE_RUN,
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeGem,
  poseScreen,
  tap,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The almanac state after the call, whatever it was called from. */
function assertEnteredAlmanac(s: WickSnapshot, from: string): void {
  assertEqual(s.screen, "almanac", `screen after setScreen('almanac') ${from}`);
  assertEqual(s.menuIndex, 0, `menuIndex after setScreen('almanac') ${from}`);
  assertEqual(s.almanacTab, 0, `almanacTab after setScreen('almanac') ${from}`);
  assertEqual(
    s.almanacScroll,
    0,
    `almanacScroll after setScreen('almanac') ${from}`,
  );
  assertDeepEqual(s.run, IDLE_RUN, `run after setScreen('almanac') ${from}`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters the almanac with the idle run and the three indices at 0", async () => {
  isolate(h);
  h.debug.setKills(5);
  h.debug.setPlayerPosition(300, -120);
  placeEnemy(h, "moth", 200, 0);
  placeGem(h, "small", 100, 100);

  assertEnteredAlmanac(poseScreen(h, "almanac"), "from a disturbed run");

  // Two `right` presses reach `ENEMIES`, the thirteen of `ENEMY_IDS`
  // (`specs/ui.md`), which is long enough for `ALMANAC_ROWS` `down` presses to
  // land the highlight on `menuIndex` `ALMANAC_ROWS` without wrapping and to
  // carry the window's first row off `0` with it.
  await tap(h, "ArrowRight");
  await tap(h, "ArrowRight");
  for (let press = 0; press < ALMANAC_ROWS; press += 1) {
    await tap(h, "ArrowDown");
  }
  const browsed = h.snapshot();
  assertGreaterThan(
    browsed.almanacTab,
    0,
    "the tab is off 0 before the second call",
  );
  assertGreaterThan(
    browsed.menuIndex,
    0,
    "the highlight is off 0 before the second call",
  );
  assertGreaterThan(
    browsed.almanacScroll,
    0,
    "the list is scrolled before the second call",
  );

  const again = poseScreen(h, "almanac");
  await h.frameDraw();
  captureStill(h, "almanac");
  assertEnteredAlmanac(again, "from the almanac itself");
});
