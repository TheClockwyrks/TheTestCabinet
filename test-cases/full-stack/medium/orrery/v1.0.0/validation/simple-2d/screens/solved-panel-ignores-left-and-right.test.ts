// screens/solved-panel-ignores-left-and-right — the panel's menu is worked with
// `up`, `down` and `confirm`, and `left` and `right` do nothing on it.
//
// THE RULE is the What each screen reads table of `specs/controls.md`. Its
// "`editor`, `faulted` or `complete`" row reads "`back` and `mute`, and `up`,
// `down`, and `confirm` while the solved panel of `specs/ui.md` is up" — and the
// sentence under the table settles the rest: "AN ACTION A ROW OMITS DOES NOTHING
// ON THAT SCREEN." The row omits `left` and `right`, so neither does anything
// while the panel is up. The two are not idle actions elsewhere: `left` and
// `right` "turn the `howto` pages" (`specs/ui.md`, Menu navigation) and move the
// tape cursor under tape focus, which is why the panel has to be checked against
// them rather than assumed safe.
//
// THE CONFIGURATION is the first Extra, completed, with the highlight posed to
// the MIDDLE item of the menu. The middle is chosen so that a build that treated
// `left` and `right` as menu movement would be caught whichever way it moved the
// highlight: from `1` a step either way lands somewhere, and neither is a wrap.
// The shelf "hold[s] exactly `EXTRA_COUNT` (`10`) challenges"
// (`specs/modes/extras.md`), so the mode holds a challenge after this one and the
// menu is the whole of `SOLVED_ITEMS`, three items deep.
//
// The machine is the set for the challenge's one product and nothing else, and
// the tally is posed straight to the `target`, because what completes the run is
// the boundary's own test: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes" (`specs/simulation.md`).
//
// THE VERDICT. After `left`, and again after `right`, `menuIndex` is still `1`,
// `screen` is still `editor`, `howtoPage` is still `0` — "`0` whenever the screen
// is not `howto`" (`specs/state.md`) — and the run is still `complete`, so
// neither press turned a page, moved the highlight, or left the panel.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { extra } from "../challenges";
import { setPart, solution } from "../formats";
import { ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  pressAction,
  type Harness,
} from "../harness";

/** The Extra this check completes: the first, which the shelf holds nine after. */
const INDEX = 0;

/** The middle item of the three, so a step either way would be visible. */
const HIGHLIGHT = 1;

/** The whole machine: the set for the challenge's one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the highlight, the screen and the how-to page alone under left and right", async () => {
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, ONE_SET);
  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);
  await h.debug.setMenuIndex(HIGHLIGHT);

  const panel = await h.snapshot();
  assertNotNull(panel.sim, "the run is still reported once it has completed");
  assertEqual(
    panel.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );
  assertEqual(
    panel.menuIndex,
    HIGHLIGHT,
    "the highlight is posed on the menu's middle item, so a step either way would show",
  );
  assertEqual(
    panel.howtoPage,
    0,
    "howtoPage is 0 whenever the screen is not howto, which is what a page turn would move",
  );

  await pressAction(h, "left");
  await h.advance(1);
  const afterLeft = await h.snapshot();

  await pressAction(h, "right");
  await h.advance(1);
  await captureStill(h, "panel-ignores-lr");
  const afterRight = await h.snapshot();

  assertEqual(
    afterLeft.menuIndex,
    HIGHLIGHT,
    "left is omitted from the editor, faulted or complete row, so it does not move the highlight",
  );
  assertEqual(afterLeft.screen, "editor", "and it does not leave the editor");
  assertEqual(afterLeft.howtoPage, 0, "and it turns no how-to page");
  assertEqual(afterLeft.sim?.status, "complete", "and it leaves the panel up");

  assertEqual(
    afterRight.menuIndex,
    HIGHLIGHT,
    "right is omitted from the same row, so it does not move the highlight either",
  );
  assertEqual(afterRight.screen, "editor", "and it does not leave the editor");
  assertEqual(afterRight.howtoPage, 0, "and it turns no how-to page");
  assertEqual(afterRight.sim?.status, "complete", "and it leaves the panel up");
});
