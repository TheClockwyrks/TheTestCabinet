// hud/inspector-fields — the inspector reports the tower that is selected: what
// it is, what level it runs at, the figures specs/towers.md gives it at that
// level, its live heat, and what it has dealt.
//
// THE RULE. specs/hud.md, The info panel and the inspector: with a placed tower
// selected the information area shows "that tower's live information", and both
// that area and the hover panel "draw the tower's size, its range, its damage or
// its effect, its fire rate, its targeting, its mass, and its radiator faces".
// "The inspector draws four things the hover panel does not: the tower's level,
// its live heat read, its kill tally, and its total damage dealt."
//
// ELEVEN READINGS, EACH POSED SO EVERY WRONG MODEL READS AS A DIFFERENT FIGURE.
// The tower is a LANCE at LEVEL II carrying a heat of {@link PINNED_HEAT}, and
// each of those choices does work:
//
//   THE TYPE is read by its name, which specs/towers.md gives as "Lance". The
//   name is read out of the information area rather than out of the whole strip,
//   because the shop draws the same eight names at all times and a panel-wide
//   reading would find the Lance's shop entry and call it the inspector.
//
//   THE LEVEL is read as the figure `2`. A build that letters every tower as
//   level I reads `1` and fails.
//
//   THE RANGE and THE FIRE RATE are read at LEVEL II — `13.0` tiles and
//   `0.92`/s — which is what makes them a reading of the level as well as of the
//   figures: specs/towers.md adds `UPGRADE_RANGE` a level and multiplies the fire
//   rate by `UPGRADE_FIRE_RATE`, so a panel showing the level-I card reads `12.0`
//   and `0.80` instead, a whole tile and a tenth of a shot away.
//
//   THE SIZE and THE MASS are read as `4` and `2.8`, which specs/towers.md leaves
//   untouched by a level.
//
//   THE LIVE HEAT is read against the heat the snapshot reports for the SAME
//   frame, so the two cannot straddle a frame boundary, and the tower is posed
//   at {@link PINNED_HEAT} with `posePinnedTower`, which holds its part in the
//   heat model (specs/instrumentation.md) so the figure the panel is held to is
//   a settled one rather than a heat still drifting under the reading.
//
//   THE DAMAGE DEALT is read as the figure the snapshot reports, after the tower
//   has really fired at a target. The tally is not posable — the surface carries
//   no operation that sets it — so it is EARNED: an unkillable target is parked
//   in range and the tower's own shots accumulate it. Reading the figure back off
//   the snapshot rather than computing it is deliberate, and it is what keeps
//   this point about the PANEL: a build whose damage arithmetic is wrong is
//   decided by `combat.*`, and here it must merely draw whatever it dealt.
//
//   THE KILL TALLY is read as the `0` the snapshot reports. The target parked in
//   range is unkillable, so the tower fires without ever killing, and the tally
//   is therefore a figure this point knows exactly. What the tally COUNTS is
//   `combat.a-gun-tallies-what-it-did`; that the inspector draws it is here.
//
//   THE LIVE PER-SHOT DAMAGE is read as `baseDamage * heatMultiplier(H, R)` at
//   the pinned heat, which specs/combat.md fixes and specs/hud.md requires the
//   damage read to show. That the multiplier CLIMBS with the heat and holds flat
//   past the redline is `hud.inspector-damage-and-multiplier`'s; that the field
//   is drawn at all is here.
//
//   THE RADIATOR FACES are read as the letters specs/towers.md names them by,
//   each accepted equally as its compass word, and THE TARGETING READ as any of
//   the case's own targeting words. Which of the three readings a tower's
//   targeting is given is `hud.targeting-read`'s; that a read is drawn is here.
//
// THE FIGURES CARRY NOTHING ELSE ON THE PANEL. The information area also holds
// the money, the lives and the wave over its total, and the run below is posed so
// none of those sits within a rounding of any figure read. The phase is `wave`,
// so the strip carries no build countdown and no next-wave preview, and the
// target never dies, so the floor never empties and nothing clears under the
// reading.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, emitterStats, heatMultiplier } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  poseTarget,
  startRun,
  ticksFor,
  towerOf,
  type Harness,
} from "../harness";
import {
  readPanel,
  readsNumber,
  readsText,
  saysFace,
  saysTargeting,
  saysWord,
  textsOf,
} from "./read";

/** The tower inspected, the name specs/towers.md gives it, and the level posed. */
const TYPE = "lance";
const NAME = "Lance";
const LEVEL = 2;

/** The same level in the Roman numerals specs/towers.md's Levels section uses. */
const ROMAN = "II";

/** A quiet anchor: no opening and no corridor within a 4x4 footprint of it. */
const AT = { col: 4, row: 4 };

/**
 * The heat the tower is pinned at.
 *
 * Below the Lance's redline of 92 and well clear of both ends of the scale, so it
 * is a figure only the heat read can be carrying, and pinned so the panel is read
 * at the heat this check posed rather than at whatever it cooled to.
 */
const PINNED_HEAT = 47;

/**
 * Where the target stands: a quiet tile about three and a half tiles from the
 * footprint centre, inside this tower's range at every level and clear of both
 * corridors, so nothing but the fire clock decides when a shot lands.
 */
const TARGET_AT = { col: 9, row: 6 };

/** How long the tower is left firing before the panel is read, in seconds.
 * At this tower's level-II rate of `0.92`/s that is several shots. */
const FIRING_SECONDS = 6;

/**
 * How far a drawn figure may sit from the figure the specification gives it.
 *
 * The table's figures are exact to a hundredth, so this admits a build that draws
 * a hundredth as a hundredth and nothing looser. It is far below the gap a level
 * opens in either the range or the fire rate.
 */
const ROUNDING = 0.05;

/**
 * How far the drawn heat and the drawn damage tally may sit from the figures the
 * snapshot reports.
 *
 * Both are running quantities rather than table entries, and specs/hud.md fixes
 * no precision for either, so a build may draw a whole number where the state
 * holds a fraction. Half a unit is exactly that allowance, with a twentieth on
 * top for the float noise in a tally that is a sum of shots.
 */
const RUNNING_ROUNDING = 0.55;

/** The tower's live per-shot damage at that heat, as specs/combat.md states it. */
const LIVE_DAMAGE = (() => {
  const def = TOWER_DEFS[TYPE];
  if (def.kind !== "emitter") {
    throw new Error(`meltdown hud/inspector-fields: ${TYPE} is not an emitter`);
  }
  return (
    emitterStats(def, LEVEL).baseDamage *
    heatMultiplier(PINNED_HEAT, def.redline)
  );
})();

/**
 * How far the drawn per-shot damage may sit from that figure: six tenths.
 *
 * The figure is a product of two tabulated numbers and lands on a fraction, and a
 * build may draw it to a tenth or round it to the whole, so half a unit for the
 * whole plus a tenth for the tenth's own rounding carries both. It is far
 * narrower than the gap to the same tower's level-I damage.
 */
const DAMAGE_ROUNDING = 0.6;

/** The run the panel is read on, posed to carry none of the figures read. */
const MODE = "containment";
const DIFFICULTY = "hard";
const MONEY = 9999;
const LIVES = 17;
const WAVE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the selected tower's type, level, figures, live heat and damage dealt", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);

  const id = posePinnedTower(h, TYPE, AT.col, AT.row, PINNED_HEAT);
  h.debug.setTowerLevel(id, LEVEL);

  poseTarget(h, "mote", TARGET_AT.col, TARGET_AT.row);

  h.debug.setSelected(id);
  await h.advance(ticksFor(FIRING_SECONDS));

  const { info } = await readPanel(h);
  captureStill(h, "inspector");
  const tower = towerOf(h.snapshot(), id);

  const def = TOWER_DEFS[TYPE];
  if (def.kind !== "emitter") {
    throw new Error(`meltdown hud/inspector-fields: ${TYPE} is not an emitter`);
  }
  const stats = emitterStats(def, LEVEL);
  const drew = JSON.stringify(textsOf(info));

  assertTrue(
    readsText(info, NAME),
    `the selected tower's type, drawn as "${NAME}", in the panel's ` +
      `information area rather than only on its shop entry (specs/hud.md, ` +
      `The info panel and the inspector; specs/towers.md); the area drew ${drew}`,
  );
  assertTrue(
    readsNumber(info, LEVEL, ROUNDING) || saysWord(info, ROMAN),
    `the selected tower's level of ${LEVEL}, drawn as the figure or as the ` +
      `Roman ${ROMAN}, which the inspector draws and the hover panel does not ` +
      `(specs/hud.md); the area drew ${drew}`,
  );
  assertTrue(
    readsNumber(info, def.size, ROUNDING),
    `the selected tower's footprint size of ${def.size} (specs/hud.md; ` +
      `specs/towers.md); the area drew ${drew}`,
  );
  assertTrue(
    readsNumber(info, stats.range, ROUNDING),
    `the selected tower's range of ${stats.range} tiles at level ${LEVEL} ` +
      `(specs/hud.md; specs/towers.md, Levels); the area drew ${drew}`,
  );
  assertTrue(
    readsNumber(info, stats.fireRate, ROUNDING),
    `the selected tower's fire rate of ${stats.fireRate.toFixed(2)} shots a ` +
      `second at level ${LEVEL} (specs/hud.md; specs/towers.md, Levels); the ` +
      `area drew ${drew}`,
  );
  assertTrue(
    readsNumber(info, def.mass, ROUNDING),
    `the selected tower's thermal mass of ${def.mass} (specs/hud.md; ` +
      `specs/towers.md); the area drew ${drew}`,
  );
  assertTrue(
    readsNumber(info, tower.heat, RUNNING_ROUNDING),
    `the selected tower's live heat of ${tower.heat.toFixed(2)}, which the ` +
      `inspector draws and the hover panel does not (specs/hud.md); the area ` +
      `drew ${drew}`,
  );
  for (const face of def.radiators) {
    assertTrue(
      saysFace(info, face),
      `the selected tower's ${face} radiator face, named by its letter or its ` +
        `compass word (specs/hud.md; specs/towers.md); the area drew ${drew}`,
    );
  }
  assertTrue(
    saysTargeting(info),
    `the selected tower's targeting read, in any of the case's own targeting ` +
      `words (specs/hud.md, The targeting read); the area drew ${drew}`,
  );
  assertTrue(
    readsNumber(info, LIVE_DAMAGE, DAMAGE_ROUNDING),
    `the selected tower's live per-shot damage of ${LIVE_DAMAGE.toFixed(2)} at ` +
      `heat ${PINNED_HEAT} (specs/hud.md, The damage read; specs/combat.md); ` +
      `the area drew ${drew}`,
  );
  assertEqual(
    tower.kills,
    0,
    "precondition: the parked target never dies, so the tower has killed nothing",
  );
  assertTrue(
    readsNumber(info, 0, ROUNDING),
    `the selected tower's kill tally of 0, which the inspector draws and the ` +
      `hover panel does not (specs/hud.md); the area drew ${drew}`,
  );
  assertTrue(
    readsNumber(info, tower.damageDealt, RUNNING_ROUNDING),
    `the selected tower's total damage dealt, which snapshot() reports as ` +
      `${tower.damageDealt.toFixed(2)} after ${FIRING_SECONDS} s of firing ` +
      `(specs/hud.md, The info panel and the inspector); the area drew ${drew}`,
  );
});
