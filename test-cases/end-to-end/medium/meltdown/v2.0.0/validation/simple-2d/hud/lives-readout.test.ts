// hud/lives-readout — the panel draws the lives remaining, and the figure follows
// the lives as they change.
//
// THE RULE. specs/hud.md, The status readouts: the panel draws the Lives readout
// "at all times during a run", showing "the lives remaining", and "each readout
// follows its value as it changes". specs/floor.md keeps every readout in the
// panel's strip, so a figure drawn on the floor is not this readout.
//
// TWO MOMENTS, BECAUSE THE REQUIREMENT IS A READOUT. The lives are posed at one
// count, read, posed at another, and read again; the first count has to be gone
// by the second reading. One reading alone would pass a panel that letters a
// number once and never moves it.
//
// THE TWO COUNTS CARRY NOTHING ELSE ON THE PANEL. The strip also holds the eight
// shop costs (`15`, `40`, `45`, `60`, `150`, `150`, `20`, `20`), the money, the
// wave over its total and the speed toggle, and neither `33` nor `8` is any of
// them. `setLives` "triggers no game over: this is a precondition"
// (specs/instrumentation.md), so both counts stand for as long as the reading
// takes.
//
// THE PHASE IS `wave`, the quietest panel this case has: specs/hud.md draws the
// build countdown only in a build phase and the next-wave preview only in a build
// or opening phase, so the strip carries the three readouts, the shop and the
// controls and nothing else. The floor is empty and the world gate is shut, so
// nothing can leak and take a life while the reading is taken (specs/surge.md).
//
// WHAT IT DOES NOT DECIDE. What the lives should BE at the start of a run is
// `modes.*`, what takes one is `surge.leak-costs-a-life`, and what happens when
// they run out is `screens.gameover-screen`. This point decides that the panel
// draws them.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, readsNumber, textsOf } from "./read";

/**
 * The two counts the lives are posed at.
 *
 * Neither is a shop cost, a starting life count, a wave number or a wave total,
 * and the two are far apart, so each reading names one figure and only the lives
 * readout can be carrying it.
 */
const FIRST = 33;
const SECOND = 8;

/** The run the panel is read on: the deepest wave total this case has. */
const MODE = "containment";
const DIFFICULTY = "hard";

/** The money and the wave posed under the reading, carrying neither count. */
const MONEY = 9999;
const WAVE = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the lives remaining in the panel, and follows them when they change", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setMoney(MONEY);
  h.debug.setWave(WAVE);

  h.debug.setLives(FIRST);
  const first = (await readPanel(h)).info;
  captureStill(h, "lives");

  assertTrue(
    readsNumber(first, FIRST),
    `the ${FIRST} lives remaining drawn in the build panel (specs/hud.md, ` +
      `The status readouts); the panel drew ${JSON.stringify(textsOf(first))}`,
  );

  h.debug.setLives(SECOND);
  const second = (await readPanel(h)).info;

  assertTrue(
    readsNumber(second, SECOND),
    `the ${SECOND} lives remaining drawn in the build panel once the lives ` +
      `changed — "each readout follows its value as it changes" ` +
      `(specs/hud.md); the panel drew ${JSON.stringify(textsOf(second))}`,
  );
  assertTrue(
    !readsNumber(second, FIRST),
    `no ${FIRST} left in the build panel once the lives fell to ${SECOND}: a ` +
      `readout shows the lives remaining rather than every count it has held ` +
      `(specs/hud.md, The status readouts); the panel drew ` +
      `${JSON.stringify(textsOf(second))}`,
  );
});
