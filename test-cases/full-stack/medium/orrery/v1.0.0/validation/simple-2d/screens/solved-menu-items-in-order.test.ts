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
// HOW THE TEXT IS READ. `specs/assets.md` puts every word on the stage on the
// frame as drawn text and fixes no more — "Which typeface carries them is
// yours" — and letter spacing is not portable, so a build is free to draw one
// entry as one call, as a call per word, or as a call per glyph. What all of
// those share is the baseline: one entry is drawn at one `y`, and stacked
// entries at different ones. So each entry is read with the shared harness's
// `drewText`, and then placed by the line it lies on — `drawing.ts`'s
// `textLines`, the same logical runs gathered onto the baselines they share,
// and `lineWith`, which finds a line by the rule `drewText` matched it by.
// Nothing here reads a coordinate, a size or a colour
// `specs/` does not fix — only which line is further down the stage than
// which, and the stage's `y` grows downward.
//
// THE VERDICT. The frame that carries the panel draws all three entries of
// `SOLVED_ITEMS`, and each is drawn below the one before it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertTrue,
} from "../assert";
import { drewText } from "../case-harness/text";
import { SOLVED_ITEMS } from "../constants";
import { extra } from "../challenges";
import { setPart, solution } from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  lineWith,
  loadMachine,
  openChallenge,
  textLines,
  type Harness,
  type TextLine,
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

it("stacks NEXT CHALLENGE, KEEP TINKERING and BACK TO SELECT down the panel", async () => {
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, ONE_SET);
  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);
  await h.advance(1);

  const calls = await h.lastCalls();
  const lines = textLines(calls);
  await captureStill(h, "menu");

  const shown = await h.snapshot();
  assertNotNull(shown.sim, "the run is still reported once it has completed");
  assertEqual(
    shown.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );

  const rows: TextLine[] = [];
  for (const item of SOLVED_ITEMS) {
    assertTrue(
      drewText(calls, item),
      `the solved panel draws the SOLVED_ITEMS entry ${item}, which the mode ` +
        "offers here because it holds a challenge after this one",
    );
    const row = lineWith(lines, item);
    assertNotNull(
      row,
      `the SOLVED_ITEMS entry ${item} lies on a line of its own`,
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
