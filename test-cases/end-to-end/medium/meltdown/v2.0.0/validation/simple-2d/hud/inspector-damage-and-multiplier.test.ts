// hud/inspector-damage-and-multiplier — the damage read shows the tower's live
// per-shot damage beside its live heat multiplier, and the multiplier stops
// climbing at the redline.
//
// THE RULE. specs/hud.md, The damage read: "An emitter's damage read shows its
// live per-shot damage beside its live heat multiplier, so a player watches the
// multiplier climb with the heat and hold flat once the heat reaches the
// redline." specs/heat.md gives both figures:
//
//   heatMultiplier(H, R) = MIN_HEAT_MULT + (MAX_HEAT_MULT - MIN_HEAT_MULT) * (min(H, R) / R)^2
//
// with the per-shot damage the tower's base damage at its level times that
// multiplier, and "at heat R and anywhere above it the multiplier is
// MAX_HEAT_MULT (3.5). Heat carried past the redline buys no damage."
//
// THREE HEATS, ONE TOWER, AND EACH HEAT SEPARATES A DIFFERENT WRONG MODEL. The
// tower is a Bloom, whose redline specs/towers.md gives as 82, and the heats are
// {@link ON_THE_CURVE} (below it), the redline itself, and {@link IN_THE_PLATEAU}
// (above it):
//
//   AT 62 the specification is due a multiplier of `2.151` and a per-shot damage
//   of `21.51`. A build that draws the BASE damage instead reads `10`; one whose
//   multiplier is linear in the heat rather than quadratic reads `2.732` and
//   `27.32`; one that forgets the multiplier entirely reads `1`. Every one of
//   those is further from the specification's figure than the tolerance below by
//   an order of magnitude.
//
//   AT THE REDLINE the multiplier is exactly `MAX_HEAT_MULT` and the damage `35`.
//
//   AT 97 both are unchanged, and that is the plateau clause. A build that lets
//   the multiplier go on climbing past the redline reads `4.758` and `47.58`
//   here, so the third reading is what the item's "stops climbing at the redline"
//   actually decides — and it is read as the SAME PAIR the redline gave rather
//   than as merely "not larger", so a build that lets it fall past the redline
//   fails too.
//
// THE HEAT IS PINNED AT EACH READING. `posePinnedTower` holds the tower's part in
// the heat model (specs/instrumentation.md) while everything else about it goes
// on running, so the multiplier the panel draws is the multiplier at the heat
// this check posed rather than at whatever the tower cooled to on the way to the
// frame. Nothing is on the floor with it, so it acquires nothing and fires
// nothing, and the heat cannot move by a shot either.
//
// THE FIGURES ARE THE SPECIFICATION'S, NOT THE SNAPSHOT'S. This is the one item
// in this group whose domain is `heat` rather than `presentation`, and its
// requirement is the CURVE the player watches: `heatMultiplier` is computed here
// from the seeded `src/constants.ts` the build was handed, so a panel that draws
// its own wrong multiplier faithfully still fails.
//
// THE FIGURES CARRY NOTHING ELSE ON THE PANEL. The information area also holds
// the money, the lives and the wave over its total, and the Bloom's own size,
// range, fire rate, mass and heat read; the run is posed so no two of those sit
// within the tolerances below of `2.151`, `21.51`, `3.5` or `35`. The phase is
// `wave`, so the strip carries no build countdown and no next-wave preview.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, emitterStats, heatMultiplier } from "../constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, readsNumber, textsOf } from "./read";

/** The tower read, and the redline specs/towers.md gives it: 82. */
const TYPE = "bloom";
const DEF = TOWER_DEFS[TYPE];
const REDLINE = DEF.kind === "emitter" ? DEF.redline : 0;

/** A quiet anchor: no opening and no corridor within a 4x4 footprint of it. */
const AT = { col: 4, row: 4 };

/**
 * The heat below the redline the curve is read at.
 *
 * Chosen so the multiplier and the damage it gives are figures nothing else on
 * this panel carries, and so far from what a linear multiplier or a forgotten one
 * would give that no tolerance could confuse them.
 */
const ON_THE_CURVE = 62;

/**
 * The heat above the redline the plateau is read at.
 *
 * Below `TRIP_HEAT`, so a tower can really sit here, and far enough above the
 * redline that a build which goes on scaling past it reads a multiplier a third
 * larger.
 */
const IN_THE_PLATEAU = 97;

/**
 * How far a drawn multiplier may sit from the figure specs/heat.md gives it.
 *
 * specs/hud.md fixes no precision for the read, so this admits a multiplier drawn
 * to one decimal — the coarsest a figure running from `0.35` to `3.5` can be
 * drawn at and still be something a player watches climb — and refuses one drawn
 * to a whole number. The wrong models it has to separate are ten times further
 * out than that: a multiplier linear in the heat reads `0.58` high at the heat
 * below the redline, and one that never plateaus reads `1.26` high above it.
 */
const MULT_ROUNDING = 0.055;

/**
 * How far a drawn per-shot damage may sit from the figure the specification
 * gives it.
 *
 * A damage read is commonly drawn to a whole point, so half a point is the
 * allowance, with a twentieth on top for float noise. The wrong models this
 * check separates are ten points and more away.
 */
const DAMAGE_ROUNDING = 0.55;

/** The run the panel is read on, posed to carry none of the figures read. */
const MODE = "containment";
const DIFFICULTY = "hard";
const MONEY = 9999;
const LIVES = 17;
const WAVE = 3;

/** The level the tower is read at: the level a placed tower starts on. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the live per-shot damage beside a multiplier that plateaus at the redline", async () => {
  if (DEF.kind !== "emitter") {
    throw new Error(
      `meltdown hud/inspector-damage-and-multiplier: ${TYPE} is not an emitter`,
    );
  }
  const base = emitterStats(DEF, LEVEL).baseDamage;

  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);

  const id = posePinnedTower(h, TYPE, AT.col, AT.row, ON_THE_CURVE);
  h.debug.setSelected(id);

  for (const heat of [ON_THE_CURVE, REDLINE, IN_THE_PLATEAU]) {
    h.debug.setTowerHeat(id, heat);
    const { info } = await readPanel(h);
    if (heat === ON_THE_CURVE) captureStill(h, "damage");

    const multiplier = heatMultiplier(heat, REDLINE);
    const damage = base * multiplier;
    const drew = JSON.stringify(textsOf(info));

    assertTrue(
      readsNumber(info, multiplier, MULT_ROUNDING),
      `the live heat multiplier of ${multiplier.toFixed(3)} drawn beside the ` +
        `damage read at heat ${heat}, against a redline of ${REDLINE} ` +
        `(specs/hud.md, The damage read; specs/heat.md); the panel's ` +
        `information area drew ${drew}`,
    );
    assertTrue(
      readsNumber(info, damage, DAMAGE_ROUNDING),
      `the live per-shot damage of ${damage.toFixed(2)} — the ${TYPE}'s base ` +
        `${base} times its multiplier at heat ${heat} — drawn in the damage ` +
        `read (specs/hud.md, The damage read; specs/heat.md); the panel's ` +
        `information area drew ${drew}`,
    );
  }
});
