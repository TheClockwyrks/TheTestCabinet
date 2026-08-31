// hud/money-readout — the panel draws the current money, and the figure follows
// the money as it changes.
//
// THE RULE. specs/hud.md, The status readouts: the panel draws the Money readout
// "at all times during a run", showing "the current money", and "each readout
// follows its value as it changes". specs/floor.md puts every readout in the
// panel's strip and none of them on the floor, so a figure drawn in the reactor
// is not this readout.
//
// TWO MOMENTS, BECAUSE THE REQUIREMENT IS A READOUT AND NOT A CAPTION. One
// reading decides only that the figure appeared once; the second separates a
// readout from a build that letters a number into its panel and never moves it
// again. So the money is posed at one figure, read, posed at another, and read
// again — and the first figure has to be GONE by the second reading, which is
// what tells a readout apart from a panel that accumulates every figure it has
// ever shown.
//
// THE TWO FIGURES ARE CHOSEN SO NOTHING ELSE ON THE PANEL CARRIES THEM. The panel
// this scenario poses also draws the eight shop costs (`15`, `40`, `45`, `60`,
// `150`, `150`, `20`, `20`), the lives, the wave over its total, and the speed
// toggle. Neither `137` nor `462` is any of those, nor within a rounding of one,
// so a reading that finds the figure has found the money readout and nothing
// standing in for it.
//
// THE PHASE IS `wave`, WHICH IS THE QUIETEST PANEL THIS CASE HAS. specs/hud.md
// draws the build countdown in a build phase and the next-wave preview in a build
// or opening phase, and the `wave` phase draws neither — so the only figures in
// the strip are the three readouts, the shop's costs and the controls. Nothing is
// spawning, because `startRun` leaves the world gate shut, and nothing is on the
// floor, so no bounty, no clear bonus and no interest can move the money under
// the reading (specs/economy.md).
//
// WHAT IT DOES NOT DECIDE. What the money should BE at the start of a run is
// `modes.*`, what moves it is `economy.*`, and whether it is legible is
// `presentation.text-legible`. This point decides that the panel draws it.

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
 * The two figures the money is posed at.
 *
 * Neither is a shop cost, a starting sum, a life count, a wave number or a wave
 * total, and the two are far apart, so each reading names one figure and only the
 * money readout can be carrying it.
 */
const FIRST = 137;
const SECOND = 462;

/** The run the panel is read on: the deepest wave total this case has. */
const MODE = "containment";
const DIFFICULTY = "hard";

/** The lives and the wave posed under the reading, chosen to carry no `137`
 * and no `462` themselves. */
const LIVES = 17;
const WAVE = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the current money in the panel, and follows it when it changes", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);

  h.debug.setMoney(FIRST);
  const first = (await readPanel(h)).info;
  captureStill(h, "money");

  assertTrue(
    readsNumber(first, FIRST),
    `the money ${FIRST} drawn in the build panel (specs/hud.md, The status ` +
      `readouts); the panel drew ${JSON.stringify(textsOf(first))}`,
  );

  h.debug.setMoney(SECOND);
  const second = (await readPanel(h)).info;

  assertTrue(
    readsNumber(second, SECOND),
    `the money ${SECOND} drawn in the build panel once the money changed — ` +
      `"each readout follows its value as it changes" (specs/hud.md); the ` +
      `panel drew ${JSON.stringify(textsOf(second))}`,
  );
  assertTrue(
    !readsNumber(second, FIRST),
    `no ${FIRST} left in the build panel once the money became ${SECOND}: a ` +
      `readout shows the current money rather than every figure it has held ` +
      `(specs/hud.md, The status readouts); the panel drew ` +
      `${JSON.stringify(textsOf(second))}`,
  );
});
