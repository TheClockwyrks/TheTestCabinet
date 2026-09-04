// screens/solved-panel-shows-metrics — the panel a completed run puts up carries
// that run's three metrics.
//
// THE RULE. "While `sim.status` is `complete`, a panel is drawn over the run
// showing `SOLVED_TITLE_TEXT` (`CHALLENGE COMPLETE`), THE FINISHED RUN'S THREE
// METRICS, the challenge's records with any new best marked, and a vertical menu
// built from `SOLVED_ITEMS`" (`specs/ui.md`, The solved panel). Which three, and
// what each is worth, is `specs/simulation.md`, Completion and metrics: `cost` is
// "The machine's cost, as `specs/parts.md` computes it", `cycles` is "`sim.cycle
// + 1` at the completing boundary", and `area` is "The size of the area bank".
// The snapshot reports the same three as `sim.metrics`
// (`specs/instrumentation.md`), so what the panel shows is held against them
// rather than against a figure this check computed for itself.
//
// THE CONFIGURATION is the first Extra — a SHIPPED challenge, so it has records
// of its own — with a machine of three `hexarm`s and the set for its one product,
// and the cycle counter posed to `998` before the completing cycle runs. That
// makes the three metrics far apart and none of them a small incidental number:
// `cost` is `3 * 60`, `cycles` is `999`, and `area` is whatever the bank holds.
// The challenge's three records are posed BELOW those figures first, so a
// completion cannot pull them up to the metrics ("the lowest `cost`, the lowest
// `cycles`, and the lowest `area` … each metric independently",
// `specs/modes/campaign.md`) and a panel that drew its records alone could not
// pass by drawing the same numbers twice.
//
// The tally is posed straight to the challenge's `target` rather than delivered,
// because what completes the run is the boundary's own test — "After the rises,
// if every set's tally has reached the challenge's `target`, the run completes"
// — and a delivery would be another point's business.
//
// HOW THE TEXT IS READ. `specs/assets.md` puts every word on the stage on the
// frame as drawn text and fixes no more, so the frame's text runs are gathered
// by the baseline they were drawn on and read left to right: a build that
// draws a figure as one call and one that draws it glyph by glyph read alike.
// A figure counts as drawn when the line carries its digits with no digit
// beside them, or when a run — or a run of consecutive runs — spells it
// exactly, which is what a right-aligned column of figures drawn beside one
// another looks like.
//
// THE VERDICT. The run really is `complete`, it really reports metrics, and the
// frame that drew the panel drew all three of them. `cycles` is the figure that
// carries the reading on its own: the readout of `specs/editor.md` shows "the
// cycle count", which is `sim.cycle` (`998`) rather than the metric (`999`), and
// the heading shows "the machine's current cost", so a build that draws no
// metrics on its panel fails here whatever its chrome shows.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { METRICS } from "../constants";
import { extra } from "../challenges";
import { armPart, setPart, solution } from "../formats";
import {
  advanceCycles,
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  textDraws,
  type Harness,
  type TextDraw,
} from "../harness";

/** The Extra this check completes: the first, which the shelf holds nine after. */
const INDEX = 0;

/** The cycle the completing cycle runs, so `cycles` is `999`. */
const POSED_CYCLE = 998;

/** Records posed below every figure the run can produce, so the two never meet. */
const RECORDS: Readonly<Record<(typeof METRICS)[number], number>> = {
  cost: 137,
  cycles: 209,
  area: 13,
};

/**
 * Three `hexarm`s and the set for the challenge's one product: `3 * 60` of cost,
 * and three rings of grippers to bank, all of it standing still on empty tapes.
 */
const MACHINE = solution([
  setPart(0, 0, -3),
  armPart("hexarm", -3, 0, 0, 1, []),
  armPart("hexarm", 0, 3, 0, 1, []),
  armPart("hexarm", 3, 0, 0, 1, []),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One baseline the frame drew text on, and the runs on it read left to right. */
interface Line {
  y: number;
  runs: string[];
  text: string;
}

/** The frame's text runs, gathered into the baselines they were drawn on. */
function linesOf(draws: readonly TextDraw[]): Line[] {
  const baselines = new Map<number, TextDraw[]>();
  for (const draw of draws) {
    baselines.set(draw.y, [...(baselines.get(draw.y) ?? []), draw]);
  }
  return [...baselines.entries()]
    .map(([y, on]) => {
      const runs = [...on].sort((a, b) => a.x - b.x).map((draw) => draw.text);
      return { y, runs, text: runs.join("") };
    })
    .sort((a, b) => a.y - b.y);
}

/**
 * Whether the frame drew `value` as a figure of its own.
 *
 * Two readings, because two builds draw a column of figures two ways. A line that
 * carries the digits with no digit on either side has drawn the figure plainly
 * (`cost: 180`). A line whose runs were drawn beside one another joins into
 * something no boundary can be found in (`cost` `180` `137` reads as
 * `cost180137`), so a consecutive group of runs that spells the figure exactly
 * counts as well.
 */
function drewFigure(lines: readonly Line[], value: number): boolean {
  const wanted = String(value);
  const plainly = lines.some((line) => {
    for (let at = line.text.indexOf(wanted); at >= 0; ) {
      const before = line.text[at - 1];
      const after = line.text[at + wanted.length];
      const digit = (char: string | undefined): boolean =>
        char !== undefined && char >= "0" && char <= "9";
      if (!digit(before) && !digit(after)) return true;
      at = line.text.indexOf(wanted, at + 1);
    }
    return false;
  });
  if (plainly) return true;
  return lines.some((line) =>
    line.runs.some((_, from) => {
      let joined = "";
      for (let to = from; to < line.runs.length; to += 1) {
        joined += (line.runs[to] as string).trim();
        if (joined === wanted) return true;
        if (joined.length >= wanted.length) return false;
      }
      return false;
    }),
  );
}

it("draws the completed run's cost, cycles and area", async () => {
  await openChallenge(h, "extras", INDEX);
  for (const metric of METRICS) {
    await h.debug.setRecord("extras", INDEX, metric, RECORDS[metric]);
  }
  await loadMachine(h, MACHINE);
  await h.debug.startRun();
  await h.debug.setCycle(POSED_CYCLE);
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);
  await h.advance(1);

  const lines = linesOf(textDraws(await h.lastCalls()));
  await captureStill(h, "metrics");

  const shown = await h.snapshot();
  assertNotNull(shown.sim, "the run is still reported once it has completed");
  assertEqual(
    shown.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );
  const metrics = shown.sim?.metrics ?? null;
  assertNotNull(
    metrics,
    "a completed run records its metrics, which is what the panel shows",
  );

  for (const metric of METRICS) {
    const value = metrics?.[metric];
    assertNotNull(
      value ?? null,
      `the completed run reports its ${metric} metric`,
    );
    assertTrue(
      value !== undefined && drewFigure(lines, value),
      `the solved panel draws the finished run's ${metric}, which sim.metrics ` +
        `reports as ${String(value)}`,
    );
  }
});
