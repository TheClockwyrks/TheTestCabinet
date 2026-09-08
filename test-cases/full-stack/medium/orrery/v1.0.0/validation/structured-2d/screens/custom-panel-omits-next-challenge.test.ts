// screens/custom-panel-omits-next-challenge — a challenge that belongs to no
// course gets a panel with no NEXT CHALLENGE on it.
//
// THE RULE is the last paragraph of `specs/ui.md`, The solved panel: "A challenge
// loaded directly through the surface of `specs/instrumentation.md` BELONGS TO NO
// COURSE, SO ITS PANEL NEVER OFFERS `NEXT CHALLENGE`, and `BACK TO SELECT` goes
// to the current `state.mode`'s select screen with every progress figure and
// record untouched." The menu's own sentence says what is left: "`NEXT CHALLENGE`
// is offered only when the mode has a challenge after this one; THE MENU IS
// OTHERWISE THE REMAINING TWO ITEMS IN THE SAME ORDER." So the menu is
// `KEEP TINKERING` then `BACK TO SELECT`.
//
// This is a different rule from `solved-omits-next-on-last-challenge`, which
// withholds the item because the mode's list RUNS OUT. Here there is no list at
// all: `loadChallenge` leaves the snapshot reporting the challenge's `source` as
// `"custom"` and its `index` as `null` (`specs/instrumentation.md`), so there is
// no index to add one to whatever the mode holds. The check reads both back
// before completing the run, so the panel it goes on to read really is a loaded
// challenge's.
//
// THE CONFIGURATION is `BARE` — one `sol` in, the same `sol` out — loaded through
// the surface, with the set for its one product as the whole machine, and the
// tally posed straight to the `target`, because what completes the run is the
// boundary's own test: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes" (`specs/simulation.md`).
//
// HOW THE TEXT IS READ. `specs/assets.md` puts every word on the stage on the
// frame as drawn text and fixes no more — "Which typeface carries them is
// yours" — and letter spacing is not portable, so a build is free to draw one
// entry as one call, as a call per word, or as a call per glyph. What all of
// those share is the baseline: one entry is drawn at one `y`, and stacked
// entries at different ones. So each entry is read with the shared harness's
// `drewText`, and the two that remain are placed by the line each lies on —
// `drawing.ts`'s `textLines`, the same logical runs gathered onto the baselines
// they share, and `lineWith`, which finds a line by the rule `drewText` matched
// it by.
//
// THE VERDICT. The frame that carries the panel draws `KEEP TINKERING` and, below
// it, `BACK TO SELECT`, and draws `NEXT CHALLENGE` nowhere at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertTrue,
} from "../assert";
import { drewText } from "../case-harness/text";
import { SOLVED_ITEMS } from "../constants";
import { setPart, solution } from "../formats";
import { BARE, ORIGIN, TARGET } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  lineWith,
  loadMachine,
  openChallengeDocument,
  textLines,
  type Harness,
} from "../harness";

/** The whole machine: the set for the loaded challenge's one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

/** The entry withheld here, and the two that remain, in SOLVED_ITEMS order. */
const [NEXT, KEEP, BACK] = SOLVED_ITEMS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves KEEP TINKERING then BACK TO SELECT, and no NEXT CHALLENGE, on a directly loaded challenge", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, ONE_SET);

  const opened = await h.snapshot();
  assertEqual(
    opened.challenge?.source,
    "custom",
    "the challenge was loaded through the surface, so it belongs to no course",
  );
  assertEqual(
    opened.challenge?.index,
    null,
    "and it carries no index into a mode's list, so there is none to follow",
  );

  await h.debug.startRun();
  await h.debug.setTally(0, TARGET);
  await advanceCycles(h, 1);
  await h.advance(1);

  const calls = await h.lastCalls();
  const lines = textLines(calls);
  await captureStill(h, "two-items");

  const shown = await h.snapshot();
  assertNotNull(shown.sim, "the run is still reported once it has completed");
  assertEqual(
    shown.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );

  assertTrue(
    !drewText(calls, NEXT as string),
    `a directly loaded challenge belongs to no course, so its panel never offers ${String(NEXT)}`,
  );

  assertTrue(
    drewText(calls, KEEP as string),
    `the menu is the remaining two items, so it draws ${String(KEEP)}`,
  );
  assertTrue(drewText(calls, BACK as string), `and it draws ${String(BACK)}`);
  const keep = lineWith(lines, KEEP as string);
  const back = lineWith(lines, BACK as string);
  assertNotNull(keep, `${String(KEEP)} lies on a line of its own`);
  assertNotNull(back, `${String(BACK)} lies on a line of its own`);
  assertGreaterThan(
    back?.y ?? Number.NEGATIVE_INFINITY,
    keep?.y ?? Number.POSITIVE_INFINITY,
    `the remaining two are in the same order, so ${String(BACK)} is drawn under ${String(KEEP)}`,
  );
});
