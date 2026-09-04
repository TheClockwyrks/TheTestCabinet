// hud/inspector-fields — the inspector reports the selected tower: its type and
// level, its stats, its live heat, and its two tallies.
//
// `specs/hud.md`, The info panel and the inspector: with a placed tower selected
// the information area shows "that tower's live information". Both panels draw
// "the tower's size, its range, its damage or its effect, its fire rate, its
// targeting, its mass, and its radiator faces", and "The inspector draws four
// things the hover panel does not: the tower's level, its live heat read, its kill
// tally, and its total damage dealt."
//
// THE POSE IS WHAT MAKES EVERY FIELD IDENTIFIABLE. A Lance at LEVEL II, pinned at
// heat `66`, and selected. At that level and that heat every figure the inspector
// must draw is a number no other number on the panel is equal to — range `13.0`,
// fire rate `0.92`, mass `2.8`, heat `66`, live damage `135.6` — so a run carrying
// one of them is carrying that field and nothing else. Level II rather than level I
// is deliberate: the four figures `specs/towers.md` scales with level all move off
// their tabulated values, so a panel that drew a Lance's level-I figures whatever
// the tower's level fails here.
//
// The heat is PINNED, through `setTowerThermal(id, false)`, which holds the
// tower's part in the heat model while everything else runs
// (`specs/instrumentation.md`). Without it the heat that the live heat read and the
// live damage are both read against would drift between the pose and the frame,
// and this point would be measuring a cooling rate `heat/*` already decides.
//
// THE TWO TALLIES ARE READ AS A COUNT OF ZEROES, which is the honest reading. A
// posed tower has fired nothing, so both its tallies are `0` — and `0` is drawn
// nowhere else on this panel, because every other figure here carries a digit
// before the point. So the panel must carry TWO runs reading `0`: a build drawing
// neither tally carries none and a build drawing one carries one. Which run is
// the kills and which the damage cannot be told apart without fixing a label, and
// this point does not try to; earning a non-zero tally would mean driving the
// firing path through a presentation point, which would make a broken emitter fail
// an item about the panel.
//
// THE LEVEL is likewise read as a presence: `2`, or the Roman `II` a build may
// equally draw. That reading is weak on its own — a `2` is on the panel from the
// shop's footprint sides — which is why the level is really decided by the four
// figures above, every one of which is the level-II value and not the level-I one.
//
// The three-way targeting read is `hud/targeting-read`'s; required here is only
// that a targeting read is drawn.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  TOWER_DEFS,
  emitterStats,
  heatMultiplier,
  isEmitter,
} from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import {
  readPanel,
  reads,
  runsReading,
  saysFace,
  saysTargeting,
  saysWord,
} from "./panel";

/** The tower selected. Its level-II figures are unlike every other panel number. */
const TYPE = "lance" as const;
const DEF = TOWER_DEFS[TYPE];

/** The level posed, so the drawn figures cannot be the tabulated level-I ones. */
const LEVEL = 2;

/** The heat pinned, which the live heat read must report. */
const HEAT = 66;

/** The Lance's figures at level II, from `specs/towers.md`'s own table. */
const STATS = isEmitter(DEF) ? emitterStats(DEF, LEVEL) : null;

/** Its live per-shot damage at that heat, as `specs/combat.md` states it. */
const LIVE_DAMAGE =
  STATS === null ? 0 : STATS.baseDamage * heatMultiplier(HEAT, STATS.redline);

/** How far a drawn figure may sit from the one it must be: a twentieth. */
const ROUNDED = 0.05;

/**
 * And how far the live damage may: six tenths.
 *
 * `135.6` may be drawn to a tenth, as the reference does, or rounded to the whole
 * `136`, and half a unit plus a tenth for the tenth's own rounding carries both.
 * It is far narrower than the gap to the level-I figure, `84.8`.
 */
const DAMAGE_ROUNDED = 0.6;

/** How near a run must read `0` to be a tally, tight enough to exclude `0.05`. */
const ZERO = 0.04;

/** The tallies the inspector draws: the kills and the total damage dealt. */
const TALLIES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the selected Lance's type, level, stats, live heat and tallies", async () => {
  if (STATS === null) {
    throw new Error(
      "hud/inspector-fields: the selected type must be an emitter",
    );
  }
  await startRun(h);
  const id = await posePinnedTower(h, TYPE, FREE_SITE.col, FREE_SITE.row, HEAT);
  await h.debug.setTowerLevel(id, LEVEL);
  await h.debug.setSelected(id);

  const runs = await readPanel(h);
  await captureStill(h, "inspector");
  const posed = await h.snapshot();
  const tower = requireTower(posed, id, "the selected tower");

  assertEqual(posed.selected, id, "precondition: the posed tower is selected");
  assertEqual(tower.level, LEVEL, "precondition: the tower stands at level II");
  assertEqual(
    tower.heat,
    HEAT,
    "precondition: the tower's heat is pinned at 66",
  );
  assertEqual(
    tower.kills,
    0,
    "precondition: the posed tower has killed nothing",
  );
  assertEqual(
    tower.damageDealt,
    0,
    "precondition: the posed tower has dealt no damage",
  );

  assertTrue(saysWord(runs, TYPE), "the inspector to name the selected tower");
  assertTrue(
    reads(runs, LEVEL, ROUNDED) || saysWord(runs, "II"),
    `the inspector to draw the tower's level, ${LEVEL} or the Roman II`,
  );
  assertTrue(
    reads(runs, DEF.size, ROUNDED),
    `the inspector to draw the footprint side of ${DEF.size}`,
  );
  assertTrue(
    reads(runs, STATS.range, ROUNDED),
    `the inspector to draw the level-II range of ${STATS.range}`,
  );
  assertTrue(
    reads(runs, STATS.fireRate, ROUNDED),
    `the inspector to draw the level-II fire rate of ${STATS.fireRate.toFixed(2)}`,
  );
  assertTrue(
    isEmitter(DEF) && reads(runs, DEF.mass, ROUNDED),
    `the inspector to draw the mass of ${isEmitter(DEF) ? DEF.mass : "n/a"}`,
  );
  for (const face of isEmitter(DEF) ? DEF.radiators : []) {
    assertTrue(
      saysFace(runs, face),
      `the inspector to name the tower's ${face} radiator face`,
    );
  }
  assertTrue(
    saysTargeting(runs),
    "the inspector to draw a targeting read (specs/hud.md, The targeting read)",
  );
  assertTrue(
    reads(runs, LIVE_DAMAGE, DAMAGE_ROUNDED),
    `the inspector to draw the live per-shot damage of ${LIVE_DAMAGE.toFixed(1)}`,
  );
  assertTrue(
    reads(runs, HEAT, ROUNDED),
    `the inspector to draw a live heat read of ${HEAT}`,
  );
  assertGreaterThanOrEqual(
    runsReading(runs, 0, ZERO).length,
    TALLIES,
    "the runs reading 0, which are the kill tally and the total damage dealt of a tower that has fired nothing",
  );
});
