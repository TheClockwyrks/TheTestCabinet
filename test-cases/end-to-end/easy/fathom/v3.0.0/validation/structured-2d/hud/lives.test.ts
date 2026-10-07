// hud/lives — the lives in reserve are on the bottom strip, one icon each.
//
// specs/ui.md keeps the lives in the bottom strip, `y` in `[656, 720]`, drawn "as
// that many small forager icons", whenever a maze is on screen. So the readout is
// a COUNT rather than a figure, and what a player reads off it is how much of the
// strip it fills.
//
// WHAT AN ICON IS IS THE BUILD'S, so what is measured is the strip. A sprite, a
// glyph, a drawn shape — every one of them puts pixels on the strip that its own
// ground does not carry, and nothing else in the strip moves when only `lives`
// changes: the depth stands, both gauges stand, and the maze is above the strip
// entirely. So the reading is how much of the bottom strip is drawn on, taken at
// three life counts in turn, and what it has to say is that each life removed
// takes about the same amount of it away.
//
// TWO PROPERTIES ARE ASSERTED, AND TOGETHER THEY ARE "ONE ICON FEWER". That the
// strip carries strictly less at each life removed — a build that draws the icons
// but never removes one fails there — and that the two drops agree with each
// other, which is what says the icons are a row of like things rather than a
// figure whose glyphs happen to change width. Neither says how big an icon is,
// which specs/ui.md leaves to the build.
//
// THE LIVES ARE POSED, NOT SPENT. `setLives` sets the reserve and nothing else
// (specs/instrumentation.md), so what changes between two readings is the count
// the HUD reports and never a maze relaid or a forager moved. What a CATCH costs
// is `scoring.three-lives`'s point.
//
// THE BOARD IS EMPTIED OF HUNTERS, so nothing can take a life under the readings.

import { afterEach, beforeEach, it } from "vitest";

import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { BOTTOM_STRIP, drawnAcross } from "./readouts";

/** The life counts read, from a full reserve down. */
const COUNTS = [START_LIVES, START_LIVES - 1, START_LIVES - 2] as const;

/**
 * How far the two drops may differ, as a share of the larger of them.
 *
 * Half. specs/ui.md fixes nothing about how an icon is drawn, so two icons of one
 * row could legitimately differ by a little — a build that animates one, or draws
 * the last differently — and what this rules out is a strip whose readout does not
 * work by the icon at all: a figure that went from `3` to `2` to `1` changes by a
 * glyph's width one step and by nothing the next.
 */
const DROP_AGREEMENT = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws one icon per life in reserve, and removes one with each life", async () => {
  startPlaying(h);
  h.debug.clearPredators();

  const drawn: number[] = [];
  for (const [at, lives] of COUNTS.entries()) {
    h.debug.setLives(lives);
    await h.advance(1);
    if (at === 0) {
      // Before the assertions, so a failing check still leaves the HUD it read.
      captureStill(h, "hud");
    }
    drawn.push(await drawnAcross(h, BOTTOM_STRIP));
  }

  const drops: number[] = [];
  for (let at = 1; at < drawn.length; at += 1) {
    const drop = drawn[at - 1] - drawn[at];
    drops.push(drop);
    assertGreaterThan(
      drop,
      0,
      `the sampled points of the bottom strip that stopped being drawn on ` +
        `when the reserve went from ${String(COUNTS[at - 1])} lives to ` +
        `${String(COUNTS[at])} — the lives are drawn as that many icons, so ` +
        "one fewer life is one fewer icon (specs/ui.md)",
    );
  }

  const worst = Math.max(...drops);
  assertLessThanOrEqual(
    Math.abs(drops[0] - drops[1]),
    worst * DROP_AGREEMENT,
    `how far the ${String(drops[0])} sampled points one life cost the strip ` +
      `differs from the ${String(drops[1])} the next cost it — a row of icons ` +
      "loses about the same amount each time (specs/ui.md)",
  );
});
