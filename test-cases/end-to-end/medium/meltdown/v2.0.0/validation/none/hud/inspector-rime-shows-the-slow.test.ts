// hud/inspector-rime-shows-the-slow — a selected Rime's inspector reads its LIVE
// slow where another emitter reads a damage figure.
//
// `specs/hud.md`, The damage read: "A selected Rime shows its live slow percentage
// where another emitter shows a damage read. That is a display convention of this
// panel and nothing more; a Rime's shots deal ordinary damage, as
// `specs/combat.md` states." The figure is `specs/combat.md`'s:
//
//   slowFactor(H) = slowCeil * (1 - H / 100),  slowCeil = 0.55 at level I
//
// TWO HEATS, BECAUSE THE WORD IN THE REQUIREMENT IS "LIVE". A Rime at heat `40`
// slows by `0.33` and the same Rime at heat `80` by `0.11`, so a panel that drew
// the level's ceiling `0.55` and never looked at the heat reads the same figure
// twice, and a panel that read the slow live reads two figures thirty points of
// percentage apart. The second reading therefore requires the first figure GONE as
// well as the second there.
//
// THE FIGURE IS ACCEPTED AS EITHER FORM. `specs/hud.md` calls it a "live slow
// percentage" and `specs/combat.md` states it as a fraction, so `33` and `0.33`
// are the same reading and both are taken. Nothing else on this panel is equal to
// either, at either heat.
//
// THE HEAT IS PINNED, through `setTowerThermal(id, false)`, because the heat is the
// argument of the figure being read (`specs/instrumentation.md`). The Rime's
// redline is `100`, so it "never reaches a plateau" (`specs/towers.md`) and both
// heats read sit on the live part of the curve.
//
// WHAT THIS POINT DOES NOT DECIDE. That the Rime's shots deal ordinary damage —
// `combat.rime-deals-its-damage` decides that, and `specs/hud.md` is explicit that
// the panel's convention "is a display convention of this panel and nothing more".
// So nothing here requires the damage figure to be ABSENT: a build that draws the
// slow and the damage both has drawn the slow where the damage read goes, and has
// told the player more rather than less.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { TOWER_DEFS, isEmitter, rimeSlowFactor } from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, reads } from "./panel";

/** The tower read. */
const TYPE = "rime" as const;
const DEF = TOWER_DEFS[TYPE];
const LEVEL = 1;

/** The two heats read: both on the live part of the Rime's curve. */
const COLD = 40;
const HOT = 80;

/** What `specs/combat.md` gives the slow at each. */
const COLD_SLOW = rimeSlowFactor(COLD, LEVEL);
const HOT_SLOW = rimeSlowFactor(HOT, LEVEL);

/** The level's ceiling, which a panel that ignored the heat would read instead. */
const CEILING =
  isEmitter(DEF) && DEF.slowCeil !== undefined ? DEF.slowCeil[LEVEL - 1] : 0;

/**
 * How far a drawn percentage may sit from the one it must be: half a point.
 *
 * A percentage is drawn as a whole number of points or with a decimal, and half a
 * point carries both onto `33` and `11`. Those two are twenty-two points apart, so
 * the window cannot let one stand in for the other, nor either for the ceiling's
 * `55`.
 */
const PERCENT_ROUNDED = 0.5;

/** And as a fraction, the same window scaled: five thousandths. */
const FRACTION_ROUNDED = 0.005;

/** Whether the panel reads `factor`, as a percentage or as a fraction. */
function readsSlow(
  runs: Awaited<ReturnType<typeof readPanel>>,
  factor: number,
): boolean {
  return (
    reads(runs, factor * 100, PERCENT_ROUNDED) ||
    reads(runs, factor, FRACTION_ROUNDED)
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reads 33% at heat 40 and 11% at heat 80, and stops reading 33%", async () => {
  await startRun(h);
  const id = await posePinnedTower(h, TYPE, FREE_SITE.col, FREE_SITE.row, COLD);
  await h.debug.setTowerLevel(id, LEVEL);
  await h.debug.setSelected(id);

  const cold = await readPanel(h);
  await captureStill(h, "slow");
  const coldTower = requireTower(await h.snapshot(), id, "the Rime at heat 40");

  await h.debug.setTowerHeat(id, HOT);
  const hot = await readPanel(h);
  const hotTower = requireTower(await h.snapshot(), id, "the Rime at heat 80");

  assertEqual(
    coldTower.heat,
    COLD,
    "precondition: the Rime's heat is pinned at 40",
  );
  assertEqual(
    hotTower.heat,
    HOT,
    "precondition: the Rime's heat is pinned at 80",
  );
  assertEqual(
    coldTower.level,
    LEVEL,
    "precondition: the Rime stands at level I",
  );

  assertTrue(
    readsSlow(cold, COLD_SLOW),
    `the inspector to read the Rime's live slow of ${(COLD_SLOW * 100).toFixed(1)}% at heat ${COLD}`,
  );
  assertTrue(
    readsSlow(hot, HOT_SLOW),
    `the inspector to read the Rime's live slow of ${(HOT_SLOW * 100).toFixed(1)}% at heat ${HOT}`,
  );
  assertTrue(
    !readsSlow(hot, COLD_SLOW),
    `the inspector to have stopped reading ${(COLD_SLOW * 100).toFixed(1)}% once the heat reached ${HOT}`,
  );
  assertTrue(
    !readsSlow(hot, CEILING),
    `the inspector not to read the level's ceiling of ${(CEILING * 100).toFixed(0)}%, which is the slow of a Rime at heat 0 and not of this one`,
  );
});
