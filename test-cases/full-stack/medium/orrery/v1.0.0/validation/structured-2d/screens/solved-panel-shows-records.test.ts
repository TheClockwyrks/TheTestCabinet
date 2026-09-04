// screens/solved-panel-shows-records — the panel carries the challenge's records
// beside the run that just finished.
//
// THE RULE. "While `sim.status` is `complete`, a panel is drawn over the run
// showing `SOLVED_TITLE_TEXT` (`CHALLENGE COMPLETE`), the finished run's three
// metrics, THE CHALLENGE'S RECORDS with any new best marked, and a vertical menu
// built from `SOLVED_ITEMS`" (`specs/ui.md`, The solved panel). What a record is
// belongs to the modes: "Each challenge keeps its records: the lowest `cost`, the
// lowest `cycles`, and the lowest `area` over the session's completed runs of it,
// each metric independently" (`specs/modes/campaign.md`, Progression, which
// `specs/modes/extras.md` adopts unchanged). The snapshot reports them per
// challenge as that mode's `records` (`specs/instrumentation.md`).
//
// THE CONFIGURATION is the first Extra — a SHIPPED challenge, so it belongs to a
// course and has records — with its three records posed through the surface to
// `137`, `209` and `13` BEFORE the run. The machine and the posed cycle counter
// then make the run's own metrics far larger than all three (`180`, `999`, and
// the bank's own size), so the completion cannot pull a record down onto the
// figure the run produced: each record is still the session's lowest, and the six
// figures on the panel are six different numbers. That is what tells this point
// apart from `solved-panel-shows-metrics`, which reads the other three.
//
// The tally is posed straight to the challenge's `target` rather than delivered,
// because what completes the run is the boundary's own test — "After the rises,
// if every set's tally has reached the challenge's `target`, the run completes"
// (`specs/simulation.md`) — and a delivery would be another point's business.
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
// THE VERDICT. The run really is `complete`, the challenge's records really are
// still the three posed figures, and the frame that drew the panel drew all three
// of them. None of the three is a figure the run produced or the editor's chrome
// carries, so a panel that shows the metrics alone fails here.

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
  progressOf,
  textDraws,
  type Harness,
  type TextDraw,
} from "../harness";

/** The Extra this check completes: the first of the shelf. */
const INDEX = 0;

/** The cycle the completing cycle runs, so the run's `cycles` is `999`. */
const POSED_CYCLE = 998;

/** The records posed on the challenge, each below anything the run can produce. */
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
 * (`best: 137`). A line whose runs were drawn beside one another joins into
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

it("draws the challenge's cost, cycles and area records", async () => {
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
  await captureStill(h, "records");

  const shown = await h.snapshot();
  assertNotNull(shown.sim, "the run is still reported once it has completed");
  assertEqual(
    shown.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );
  const held = progressOf(shown, "extras").records[INDEX] ?? null;
  assertNotNull(
    held,
    "the challenge carries a record once a run of it has completed",
  );

  for (const metric of METRICS) {
    assertEqual(
      held?.[metric],
      RECORDS[metric],
      `the run was worse than the posed ${metric} record, so the record is ` +
        "still the session's lowest and the panel has it to show",
    );
    assertTrue(
      drewFigure(lines, RECORDS[metric]),
      `the solved panel draws the challenge's ${metric} record, which is ` +
        `${String(RECORDS[metric])}`,
    );
  }
});
