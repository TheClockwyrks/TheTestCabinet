// screens/solved-back-to-select-goes-to-select — taking BACK TO SELECT leaves the
// editor for the current mode's list.
//
// THE RULE is the third row of the solved panel's `confirm` table in
// `specs/ui.md`, The solved panel: "`BACK TO SELECT` | GOES TO `select`." Which
// list that is belongs to `specs/ui.md`, Screens: "`state.mode` is `campaign` or
// `extras`, and decides which course the `select` and `editor` screens serve", so
// the screen reached is the select screen of the mode the editor was serving.
//
// `specs/controls.md` grants the press: the "`editor`, `faulted` or `complete`"
// row of What each screen reads carries "`up`, `down`, and `confirm` while the
// solved panel of `specs/ui.md` is up".
//
// THE CONFIGURATION is the first Extra, completed, WITH THE MODE SET TO EXTRAS
// FIRST, so the mode the check reads back is one it put there rather than the
// resting one. The shelf "hold[s] exactly `EXTRA_COUNT` (`10`) challenges"
// (`specs/modes/extras.md`), so the mode holds a challenge after this one and the
// menu is the whole of `SOLVED_ITEMS` — which puts `BACK TO SELECT`, its third
// entry, at index `2`. The highlight is posed there through the surface and read
// back, so the item `confirm` takes is the one this point is about.
//
// The machine is the set for the challenge's one product and nothing else, and
// the tally is posed straight to the `target`, because what completes the run is
// the boundary's own test: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes" (`specs/simulation.md`).
//
// THE VERDICT. `screen` is `select` after the press, and `mode` is still
// `extras`, the mode the editor was serving.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
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
  poseMenuIndex,
  pressAction,
  type Harness,
} from "../harness";

/** The Extra this check completes: the first, which the shelf holds nine after. */
const INDEX = 0;

/** Where BACK TO SELECT sits when all three items are offered. */
const BACK_ITEM = 2;

/** The whole machine: the set for the challenge's one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("goes to the current mode's select screen on confirm", async () => {
  await h.debug.reset();
  await h.debug.setMode("extras");
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, ONE_SET);
  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);
  await poseMenuIndex(h, BACK_ITEM);

  const panel = await h.snapshot();
  assertNotNull(panel.sim, "the run is still reported once it has completed");
  assertEqual(
    panel.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );
  assertEqual(
    panel.screen,
    "editor",
    "the panel is drawn on the editor rather than being a screen of its own",
  );
  assertEqual(
    panel.mode,
    "extras",
    "the editor is serving the Extras, which is the mode its select screen belongs to",
  );
  assertEqual(
    panel.menuIndex,
    BACK_ITEM,
    `the highlight stands on ${String(SOLVED_ITEMS[BACK_ITEM])}, the third entry of SOLVED_ITEMS`,
  );

  await pressAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "select");

  const left = await h.snapshot();
  assertEqual(left.screen, "select", "BACK TO SELECT goes to select");
  assertEqual(
    left.mode,
    "extras",
    "and the select screen it goes to is the current mode's",
  );
});
