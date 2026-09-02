// screens/solved-menu-items-in-order — the panel's menu is the three entries of
// SOLVED_ITEMS, stacked down the panel in that order.
//
// THE RULE. The panel shows "a vertical menu built from `SOLVED_ITEMS`
// (`NEXT CHALLENGE`, `KEEP TINKERING`, `BACK TO SELECT`, in that order)"
// (`specs/ui.md`, The solved panel). The menu is VERTICAL and the order is the
// order the constant is written in, so `KEEP TINKERING` is drawn under
// `NEXT CHALLENGE` and `BACK TO SELECT` under `KEEP TINKERING`.
//
// THE CONFIGURATION is the FIRST Extra, completed. The shelf "hold[s] exactly
// `EXTRA_COUNT` (`10`) challenges" (`specs/modes/extras.md`), so the mode holds
// nine challenges after this one and the whole of `SOLVED_ITEMS` is offered:
// "`NEXT CHALLENGE` is offered only when the mode has a challenge after this
// one". Which entries are offered where is not this point's business — that is
// `solved-offers-next-challenge` and `solved-omits-next-on-last-challenge` — but
// a menu of all three is where the ORDER of all three can be read.
//
// The machine is the set for the challenge's one product and nothing else, and
// the tally is posed straight to the `target`, because what completes the run is
// the boundary's own test: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes" (`specs/simulation.md`).
//
// HOW THE TEXT IS READ. Nothing in `specs/` says how a string reaches the canvas,
// and letter spacing is not portable, so a build is free to draw one entry as one
// call, as a call per word, or as a call per glyph. What all of those share is
// the baseline: one entry is drawn at one `y`, and stacked entries at different
// ones. So the frame's text runs are gathered by the `y` their anchor maps to and
// joined in `x` order, and each entry is found by the line it lies on. Nothing
// here reads a coordinate, a size or a colour `specs/` does not fix — only which
// line is further down the stage than which, and the stage's `y` grows downward.
//
// THE VERDICT. The frame that carries the panel draws all three entries of
// `SOLVED_ITEMS`, and each is drawn below the one before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { SOLVED_ITEMS } from "../constants";
import { extra } from "../challenges";
import { setPart, solution } from "../formats";
import { ORIGIN } from "../fixtures";
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

/** The whole machine: the set for the challenge's one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

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
  text: string;
}

/** The frame's text runs, gathered into the baselines they were drawn on. */
function linesOf(draws: readonly TextDraw[]): Line[] {
  const baselines = new Map<number, TextDraw[]>();
  for (const draw of draws) {
    baselines.set(draw.y, [...(baselines.get(draw.y) ?? []), draw]);
  }
  return [...baselines.entries()]
    .map(([y, on]) => ({
      y,
      text: [...on]
        .sort((a, b) => a.x - b.x)
        .map((draw) => draw.text)
        .join(""),
    }))
    .sort((a, b) => a.y - b.y);
}

/** The topmost line the frame drew `text` on, or `null` when it drew it on none. */
function lineWith(lines: readonly Line[], text: string): Line | null {
  const wanted = text.trim().toLowerCase();
  return lines.find((line) => line.text.toLowerCase().includes(wanted)) ?? null;
}

it("stacks NEXT CHALLENGE, KEEP TINKERING and BACK TO SELECT down the panel", async () => {
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, ONE_SET);
  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);
  await h.advance(1);

  const lines = linesOf(textDraws(await h.lastCalls()));
  await captureStill(h, "menu");

  const shown = await h.snapshot();
  assertNotNull(shown.sim, "the run is still reported once it has completed");
  assertEqual(
    shown.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );

  const rows: Line[] = [];
  for (const item of SOLVED_ITEMS) {
    const row = lineWith(lines, item);
    assertNotNull(
      row,
      `the solved panel draws the SOLVED_ITEMS entry ${item}, which the mode ` +
        "offers here because it holds a challenge after this one",
    );
    if (row !== null) rows.push(row);
  }
  assertEqual(
    rows.length,
    SOLVED_ITEMS.length,
    "every entry of SOLVED_ITEMS has a line of its own to place",
  );

  for (let index = 1; index < rows.length; index += 1) {
    assertGreaterThan(
      rows[index]?.y ?? Number.NEGATIVE_INFINITY,
      rows[index - 1]?.y ?? Number.POSITIVE_INFINITY,
      `the menu is vertical and in SOLVED_ITEMS order, so ${SOLVED_ITEMS[index]} ` +
        `is drawn under ${SOLVED_ITEMS[index - 1]}`,
    );
  }
});
