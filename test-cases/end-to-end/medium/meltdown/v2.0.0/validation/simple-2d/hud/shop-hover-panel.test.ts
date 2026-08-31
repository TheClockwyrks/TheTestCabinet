// hud/shop-hover-panel — hovering a shop entry shows THAT type's information, at
// level I, without arming or selecting anything.
//
// THE RULE. specs/hud.md, The info panel and the inspector: one area of the panel
// shows tower information, and "with a shop entry hovered, that type's
// information at level I". Both that area and the inspector "draw the tower's
// size, its range, its damage or its effect, its fire rate, its targeting, its
// mass, and its radiator faces", and the inspector draws four things the hover
// panel does not — the level, the live heat read, the kill tally and the damage
// dealt.
//
// FOUR OF THE SEVEN FIELDS ARE READ AS FIGURES, and they are the four the
// specification states as figures a hover can be held to. specs/towers.md gives
// every tower a size, a range, a fire rate and a mass, and specs/towers.md's
// Levels section says exactly what level I means for each: the range and the fire
// rate at level I are the table's own, and the size and the mass are the same at
// every level. So a hovered Lance is due `4`, `12.0`, `0.80` and `2.8`, and a
// hovered Stutter `2`, `5.0`, `7.00` and `0.5`.
//
// THE OTHER THREE ARE DECIDED ELSEWHERE OR NOT AT ALL. The targeting read is
// `hud.targeting-read`, which reads it without the specification having to fix
// its words. The damage-or-effect read and the radiator faces are not read here:
// specs/hud.md fixes no words for a face and, for a type that is not on the floor
// and so carries no heat, does not say whether the damage read is the base figure
// or the figure at heat `0`. Asserting either would be asserting a choice the
// specification leaves open.
//
// TWO TYPES, BECAUSE THE PANEL SHOWS *THAT* TYPE. One hover decides only that
// some tower's figures appeared; the second, on a type whose four figures are
// different in every one of them, separates a panel that answers the hover from
// one that letters a single tower's card. The Lance's `12.0` and `2.8` must be
// GONE once the Stutter is hovered.
//
// THE FIGURES CARRY NOTHING ELSE ON THE PANEL. The strip also holds the money,
// the lives, the wave over its total, the eight shop costs and the speed toggle,
// and the run below is posed so that none of those sits within {@link ROUNDING}
// of any of the eight figures read.
//
// THE HOVER IS POSED, NOT POINTED AT. specs/instrumentation.md's `setHoverShop`
// "sets the shop entry currently hovered, so the panel shows that type's info",
// which is the state this requirement is about; that a pointer over an entry
// reaches that state is `controls.pointer-hovers-the-shop`. Nothing is armed and
// nothing is selected, and both are read back, because specs/hud.md gives the
// information area three contents and this is the one a bare hover selects.
//
// THE PHASE IS `wave`, the quietest panel this case has, and it is also the phase
// in which the information area has nothing else to fall back on: specs/hud.md
// draws the next-wave preview only in a build or an opening phase.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, emitterStats } from "../../src/constants";
import { assertNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, readsNumber, textsOf } from "./read";

/** The two types hovered, whose four level-I figures differ in every one. */
const FIRST = "lance";
const SECOND = "stutter";

/**
 * How far a drawn figure may sit from the figure specs/towers.md gives it.
 *
 * Every one of the eight is exact to a tenth in the table, so this is the
 * allowance for a build that draws a tenth as a tenth. It is far below the gap
 * between a level-I figure and its level-II counterpart — a level moves the Lance's
 * range by a whole tile and its fire rate by `0.12` — so a panel showing an
 * upgraded card fails rather than passing on the tolerance.
 */
const ROUNDING = 0.05;

/** The run the panel is read on, posed to carry none of the eight figures. */
const MODE = "containment";
const DIFFICULTY = "hard";
const MONEY = 9999;
const LIVES = 17;
const WAVE = 3;

/** The level a hovered type's information is shown at (specs/hud.md). */
const LEVEL = 1;

/** The four figures specs/towers.md gives `type` at level I. */
function levelOneFigures(
  type: "lance" | "stutter",
): { name: string; value: number }[] {
  const def = TOWER_DEFS[type];
  if (def.kind !== "emitter") {
    throw new Error(`meltdown hud/shop-hover-panel: ${type} is not an emitter`);
  }
  const stats = emitterStats(def, LEVEL);
  return [
    { name: "size", value: def.size },
    { name: "range", value: stats.range },
    { name: "fire rate", value: stats.fireRate },
    { name: "mass", value: def.mass },
  ];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows the hovered type's size, range, fire rate and mass at level I", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);

  h.debug.setHoverShop(FIRST);
  const first = (await readPanel(h)).info;
  captureStill(h, "hover");
  const hovered = h.snapshot();

  assertNull(
    hovered.build,
    "no placement armed while a shop entry is merely hovered (specs/hud.md, " +
      "The info panel and the inspector)",
  );
  assertNull(
    hovered.selected,
    "nothing selected while a shop entry is merely hovered (specs/hud.md, " +
      "The info panel and the inspector)",
  );

  for (const { name, value } of levelOneFigures(FIRST)) {
    assertTrue(
      readsNumber(first, value, ROUNDING),
      `the ${FIRST}'s level-I ${name} of ${value} drawn in the panel while ` +
        `the ${FIRST} is hovered (specs/hud.md, The info panel and the ` +
        `inspector; specs/towers.md); the panel drew ` +
        `${JSON.stringify(textsOf(first))}`,
    );
  }

  h.debug.setHoverShop(SECOND);
  const second = (await readPanel(h)).info;

  for (const { name, value } of levelOneFigures(SECOND)) {
    assertTrue(
      readsNumber(second, value, ROUNDING),
      `the ${SECOND}'s level-I ${name} of ${value} drawn in the panel once ` +
        `the ${SECOND} is the hovered entry (specs/hud.md; specs/towers.md); ` +
        `the panel drew ${JSON.stringify(textsOf(second))}`,
    );
  }
  for (const { name, value } of levelOneFigures(FIRST)) {
    assertTrue(
      !readsNumber(second, value, ROUNDING),
      `no ${FIRST} ${name} of ${value} left in the panel once the ${SECOND} ` +
        `is hovered: the area shows THAT type's information (specs/hud.md, ` +
        `The info panel and the inspector); the panel drew ` +
        `${JSON.stringify(textsOf(second))}`,
    );
  }
});
