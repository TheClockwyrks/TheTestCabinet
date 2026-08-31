// hud/inspector-rime-shows-the-slow — a selected Rime's inspector reads its live
// slow, where another emitter's reads its damage.
//
// THE RULE. specs/hud.md, The damage read: "A selected Rime shows its live slow
// percentage where another emitter shows a damage read. That is a display
// convention of this panel and nothing more; a Rime's shots deal ordinary damage,
// as specs/combat.md states." specs/combat.md gives the figure:
//
//   slowFactor(H) = slowCeil * (1 - H / 100)
//
// with `slowCeil` the `RIME_SLOW_CEIL` at the Rime's level — `0.55`, `0.68` or
// `0.80` — and the read is that fraction as a PERCENTAGE, which is the word
// specs/hud.md uses.
//
// THE HEAT AND THE LEVEL ARE BOTH POSED AWAY FROM THEIR DEFAULTS, so every wrong
// model reads as a different figure. A Rime at level II carrying a heat of
// {@link PINNED_HEAT} is due `0.68 * 0.7`, which is `47.6%`:
//
//   a build that reads the level-I ceiling reads `38.5`;
//   one that reads the ceiling itself, ignoring the heat, reads `68`;
//   one that runs the slow the way the DAMAGE runs — up with the heat rather
//     than down — reads `20.4`;
//   one that draws the fraction rather than the percentage reads `0.476`.
//
// Every one of those is further out than the tolerance below by more than a
// factor of ten, so a failure names which model the build wrote.
//
// THE HEAT IS PINNED. `posePinnedTower` holds the tower's part in the heat model
// (specs/instrumentation.md), so the slow the panel draws is the slow at the heat
// this check posed rather than at whatever the tower cooled to. Nothing is on the
// floor with it, so it fires at nothing and applies its slow to nothing: this
// point is about the READ, and what the slow does to a unit is
// `combat.rime-slows-what-it-hits`.
//
// WHAT IT DOES NOT DECIDE. That the Rime deals ordinary damage is
// `combat.rime-deals-its-damage`, and this point is careful not to contradict it:
// the item's own description says the panel's convention "is a display convention
// and nothing more", so nothing here reads a damage figure or asserts its
// absence.
//
// THE FIGURE CARRIES NOTHING ELSE ON THE PANEL. The information area also holds
// the money, the lives, the wave over its total, and the Rime's own size, range,
// fire rate, mass and heat read, and the run is posed so none of those sits
// within the tolerance of `47.6`. The phase is `wave`, so the strip carries no
// build countdown and no next-wave preview.

import { afterEach, beforeEach, it } from "vitest";
import { RIME_SLOW_CEIL } from "../../src/constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, readsNumber, textsOf } from "./read";

/** The one tower whose read is a slow rather than a damage (specs/hud.md). */
const TYPE = "rime";

/** A quiet anchor: no opening and no corridor within a 4x4 footprint of it. */
const AT = { col: 4, row: 4 };

/** The level posed, so a build reading the level-I ceiling reads a figure nine
 * points out. */
const LEVEL = 2;

/**
 * The heat the tower is pinned at.
 *
 * Neither `0`, where the slow is the whole ceiling and a build that ignores the
 * heat could not be told apart, nor near `100`, where it is nothing at all.
 */
const PINNED_HEAT = 30;

/**
 * The slow the specification gives that pose, as a percentage: `47.6`.
 *
 * specs/combat.md's `slowCeil * (1 - H / 100)` at level II and heat 30, times a
 * hundred, because specs/hud.md draws it as a percentage.
 */
const SLOW_PERCENT = RIME_SLOW_CEIL[LEVEL - 1] * (1 - PINNED_HEAT / 100) * 100;

/**
 * How far the drawn percentage may sit from that figure.
 *
 * A percentage is commonly drawn to a whole point, so half a point is the
 * allowance with a twentieth on top for float noise. The wrong models this check
 * separates are nine points and more away.
 */
const ROUNDING = 0.55;

/** The run the panel is read on, posed to carry nothing near `47.6`. */
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

it("draws the selected Rime's live slow percentage", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);

  const id = posePinnedTower(h, TYPE, AT.col, AT.row, PINNED_HEAT);
  h.debug.setTowerLevel(id, LEVEL);
  h.debug.setTowerHeat(id, PINNED_HEAT);
  h.debug.setSelected(id);

  const { info } = await readPanel(h);
  captureStill(h, "slow");

  assertTrue(
    readsNumber(info, SLOW_PERCENT, ROUNDING),
    `the selected Rime's live slow of ${SLOW_PERCENT.toFixed(1)}% — its ` +
      `level-${LEVEL} ceiling of ${RIME_SLOW_CEIL[LEVEL - 1]} falling with a ` +
      `heat of ${PINNED_HEAT} (specs/combat.md, The Rime's slow) — drawn ` +
      `where another emitter shows a damage read (specs/hud.md, The damage ` +
      `read); the panel's information area drew ` +
      `${JSON.stringify(textsOf(info))}`,
  );
});
