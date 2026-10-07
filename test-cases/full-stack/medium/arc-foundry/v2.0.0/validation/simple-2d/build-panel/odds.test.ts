// build-panel/odds — the panel draws the roll odds the press is actually on.
//
// `specs/hud.md` puts "the quality-roll odds at the live refinement level" at the
// top of the build panel, "so the player reads the probability of each of the
// five tiers before placing a rock", and `specs/scrap-press.md` fixes those odds
// as `REFINEMENT_ODDS[R]` — "one five-tier distribution per level, each summing
// to `1`". `specs/instrumentation.md` reports the same five numbers as
// `qualityOdds`.
//
// A build is free to draw a probability as a percentage or as a fraction, so a
// figure counts as drawn when it reads as either. Only the tiers the press can
// actually roll are required: a tier at `0.00` is not a probability the player
// has to read, and how a build shows an impossible tier is its own business.
//
// READ AS THE ROW THE PANEL DREW IT AS, NEVER AS AN ORDER AND NEVER AS LOOSE
// FIGURES ANYWHERE IN THE PANEL. Nothing in the specification fixes which end of
// the distribution a build starts at, or whether it sets the tiers across a line
// or down a column, so no order is asked for. Two things are asked instead.
//
// MULTIPLICITY. `specs/hud.md` wants "the probability of each of the five
// tiers", and at `R5` three separate tiers read `0.30`; a panel drawing one
// `30%` has not given each tier its own probability. So the level's non-zero
// tiers are matched against the figures as a MULTISET: `R5` needs three separate
// figures reading `30` and one reading `10`. That is also what makes the redraw
// bite — a panel frozen on `R2`'s row draws one `30` where `R5` needs three, so
// a stale row fails outright instead of passing on a coincidence.
//
// TOGETHERNESS. The panel also draws a refinement cost, a stamp allowance and
// the incoming wave's composition, and any of those figures can equal a
// probability by coincidence — `4 UNITS · 60 SPEED` carries a `60`. So the
// figures are read A LINE AT A TIME, and a row is a RUN OF CONSECUTIVE LINES
// carrying the tiers: one line for a panel that sets them across it, as many
// lines as tiers for one that sets them down a column, wherever in the panel
// that block sits. From each line a run could start on, the shortest run that
// carries the tiers is the candidate, so the block a panel answers is the row
// and not the panel around it.
//
// AND THE REDRAW IS ASKED OF THE ROW, NOT OF THE PANEL. Once the press is at
// `R5`, SOME block spelling `R5`'s row has to be a block that does NOT also
// spell `R2`'s — the odds row itself is such a block, since three thirties and a
// ten are not sixty, thirty and ten. Asking it of the whole panel instead is
// what let the wave preview's stray `60` counterfeit `R2`'s Scrap odds and fail
// a panel that was drawing `R5` correctly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  figureLines,
  type Harness,
  openYard,
  PANEL,
} from "../harness";
import { REFINEMENT_ODDS } from "../constants";

const COARSE = 2;
const REFINED = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** A figure reads as a probability drawn as a percentage or as a fraction. */
function reads(figure: number, odd: number): boolean {
  return Math.abs(figure - odd * 100) <= 0.5 || Math.abs(figure - odd) <= 0.005;
}

/**
 * Whether `drawn` carries a distribution's tiers, one figure apiece.
 *
 * The tiers the press cannot roll are left out, for the reason the header gives;
 * each of the rest has to find a figure of its own, so three tiers at `0.30`
 * need three figures and not one read three times. Order is not asked for, and
 * figures the tiers do not claim are free to sit anywhere among them.
 */
function carries(drawn: readonly number[], odds: readonly number[]): boolean {
  const left = [...drawn];
  for (const odd of odds.filter((o) => o > 0)) {
    const at = left.findIndex((figure) => reads(figure, odd));
    if (at === -1) return false;
    left.splice(at, 1);
  }
  return true;
}

/**
 * Every block of consecutive panel lines that carries `odds`, shortest first
 * from each line the run could start on.
 *
 * One entry per starting line, holding that block's figures — the run of lines
 * beginning there that first carries the row, and no longer. A panel that draws
 * the row on one line answers one-line blocks; one that draws it down a column
 * answers the column. A panel that draws no such row answers nothing.
 */
function oddsBlocks(
  lines: readonly (readonly number[])[],
  odds: readonly number[],
): number[][] {
  const blocks: number[][] = [];
  for (let start = 0; start < lines.length; start += 1) {
    const block: number[] = [];
    for (let end = start; end < lines.length; end += 1) {
      block.push(...lines[end]!);
      if (carries(block, odds)) {
        blocks.push([...block]);
        break;
      }
    }
  }
  return blocks;
}

/** A distribution's non-zero tiers, as the failure message spells them. */
function row(odds: readonly number[]): string {
  return odds.filter((odd) => odd > 0).join(", ");
}

it("draws the live quality odds, and redraws them when the press is refined", async () => {
  openYard(h, { refinement: COARSE });

  const coarse = figureLines(await h.frameCalls(), PANEL);
  assertEqual(
    oddsBlocks(coarse, REFINEMENT_ODDS[COARSE]!).length > 0,
    true,
    `whether the panel draws the R${COARSE} odds row ` +
      `${row(REFINEMENT_ODDS[COARSE]!)}; its lines drew ` +
      `${coarse.map((line) => `[${line.join(" ")}]`).join(" ")}`,
  );

  h.debug.setRefinement(REFINED);
  const refined = figureLines(await h.frameCalls(), PANEL);
  captureStill(h, "odds");
  const blocks = oddsBlocks(refined, REFINEMENT_ODDS[REFINED]!);
  assertEqual(
    blocks.length > 0,
    true,
    `whether the panel draws the R${REFINED} odds row ` +
      `${row(REFINEMENT_ODDS[REFINED]!)}; its lines drew ` +
      `${refined.map((line) => `[${line.join(" ")}]`).join(" ")}`,
  );
  assertEqual(
    blocks.some((block) => !carries(block, REFINEMENT_ODDS[COARSE]!)),
    true,
    `whether the row the panel draws at R${REFINED} is R${REFINED}'s alone ` +
      `and not still R${COARSE}'s ${row(REFINEMENT_ODDS[COARSE]!)}; the ` +
      `blocks that spell R${REFINED}'s row drew ` +
      `${blocks.map((block) => `[${block.join(" ")}]`).join(" ")}`,
  );
});
