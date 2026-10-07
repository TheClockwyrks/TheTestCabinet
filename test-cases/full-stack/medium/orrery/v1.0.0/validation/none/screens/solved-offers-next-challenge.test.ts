// screens/solved-offers-next-challenge — a challenge the mode holds another after
// gets the whole of SOLVED_ITEMS on its panel.
//
// THE RULE is the sentence after the menu's own in `specs/ui.md`, The solved
// panel: the menu is "built from `SOLVED_ITEMS` (`NEXT CHALLENGE`,
// `KEEP TINKERING`, `BACK TO SELECT`, in that order). `NEXT CHALLENGE` IS OFFERED
// ONLY WHEN THE MODE HAS A CHALLENGE AFTER THIS ONE; the menu is otherwise the
// remaining two items in the same order." This point decides the side of that
// rule where the challenge is not the last one: all three items are on the menu.
// The other side is `solved-omits-next-on-last-challenge`.
//
// THE CONFIGURATION is the FIRST Extra. "The Extras hold exactly `EXTRA_COUNT`
// (`10`) challenges, numbered `1` through `10`" (`specs/modes/extras.md`), so
// index `0` has nine challenges after it whatever else the build ships, and
// `specs/challenges.md` is authoritative for every one of them. The machine is
// the set for the challenge's one product and nothing else, and the tally is
// posed straight to the `target`, because what completes the run is the
// boundary's own test: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes" (`specs/simulation.md`).
//
// HOW THE TEXT IS READ. `specs/assets.md` puts every word on the stage on the
// frame as drawn text and fixes no more — "Which typeface carries them is
// yours" — and letter spacing is not portable, so a build is free to draw one
// entry as one call, as a call per word, or as a call per glyph. What all of
// those share is the baseline: one entry is drawn at one `y`. So each entry is
// read with the shared harness's `drewText` — the frame's logical runs gathered
// onto the baselines they share, matched by substring, ignoring case and
// whitespace.
//
// THE VERDICT. The frame that carries the panel draws all three entries of
// `SOLVED_ITEMS`, `NEXT CHALLENGE` included, and the challenge really is the
// Extras' first rather than its last.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { drewText } from "../case-harness/text";
import { EXTRA_COUNT, SOLVED_ITEMS } from "../constants";
import { extra } from "../challenges";
import { setPart, solution } from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  type Harness,
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

it("offers NEXT CHALLENGE, KEEP TINKERING and BACK TO SELECT on a challenge the mode holds one after", async () => {
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, ONE_SET);
  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);
  await h.advance(1);

  const calls = await h.lastCalls();
  await captureStill(h, "three-items");

  const shown = await h.snapshot();
  assertNotNull(shown.sim, "the run is still reported once it has completed");
  assertEqual(
    shown.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );
  assertEqual(
    shown.challenge?.source,
    "extras",
    "the completed challenge belongs to the Extras, so the mode's shelf decides its menu",
  );
  assertEqual(
    shown.challenge?.index,
    INDEX,
    "and it is the shelf's first challenge",
  );
  assertGreaterThan(
    EXTRA_COUNT - 1,
    INDEX,
    "the Extras hold exactly EXTRA_COUNT (10) challenges, so the mode holds a " +
      "challenge after this one",
  );

  for (const item of SOLVED_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the mode holds a challenge after this one, so the panel's menu is the ` +
        `whole of SOLVED_ITEMS and draws ${item}`,
    );
  }
});
