// screens/custom-panel-back-to-select-uses-mode — BACK TO SELECT on a loaded
// challenge's panel goes to the select screen of the mode the game is in.
//
// THE RULE is the last paragraph of `specs/ui.md`, The solved panel: "A challenge
// loaded directly through the surface of `specs/instrumentation.md` belongs to no
// course, so its panel never offers `NEXT CHALLENGE`, and `BACK TO SELECT` GOES
// TO THE CURRENT `state.mode`'S SELECT SCREEN with every progress figure and
// record untouched." A loaded challenge names no mode of its own — its `source`
// is `"custom"` and its `index` is `null` (`specs/instrumentation.md`) — so the
// mode the screen serves is the one the state carries: "`state.mode` is
// `campaign` or `extras`, and decides which course the `select` and `editor`
// screens serve" (`specs/ui.md`, Screens).
//
// `specs/controls.md` grants the press: the "`editor`, `faulted` or `complete`"
// row of What each screen reads carries "`up`, `down`, and `confirm` while the
// solved panel of `specs/ui.md` is up".
//
// THE CONFIGURATION SETS THE MODE AWAY FROM ITS RESTING VALUE FIRST. A `reset`
// "restores every declared field of the state to its title-screen value", so the
// check moves `mode` to `extras` through `setMode`, which "Sets the course the
// select and editor screens serve", and reads it back — otherwise a build that
// always went to one fixed mode's list would pass by accident. Then `BARE` is
// loaded through the surface, the set for its one product is the whole machine,
// and the tally is posed straight to the `target`, because what completes the run
// is the boundary's own test (`specs/simulation.md`).
//
// The highlight is posed to `1`, which is where `BACK TO SELECT` sits on a loaded
// challenge's panel: the menu there is "the remaining two items in the same
// order", `KEEP TINKERING` then `BACK TO SELECT`.
//
// THE VERDICT. `screen` is `select` after the press, and `mode` is `extras` —
// the mode the state carried rather than a default the build chose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { setPart, solution } from "../formats";
import { BARE, ORIGIN, TARGET } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  loadMachine,
  openChallengeDocument,
  pressAction,
  type Harness,
} from "../harness";

/** Where BACK TO SELECT sits on a panel that offers the remaining two items. */
const BACK_ITEM = 1;

/** The whole machine: the set for the loaded challenge's one product. */
const ONE_SET = solution([setPart(0, ORIGIN.q, ORIGIN.r)]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("goes to the current mode's select screen from a loaded challenge's panel", async () => {
  await h.debug.reset();
  await h.debug.setMode("extras");
  await openChallengeDocument(h, BARE);
  await loadMachine(h, ONE_SET);

  const opened = await h.snapshot();
  assertEqual(
    opened.challenge?.source,
    "custom",
    "the challenge was loaded through the surface, so it belongs to no course",
  );
  assertEqual(
    opened.mode,
    "extras",
    "the state carries the Extras as its mode, which is the course this press must serve",
  );

  await h.debug.startRun();
  await h.debug.setTally(0, TARGET);
  await advanceCycles(h, 1);
  await h.debug.setMenuIndex(BACK_ITEM);

  const panel = await h.snapshot();
  assertNotNull(panel.sim, "the run is still reported once it has completed");
  assertEqual(
    panel.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );
  assertEqual(
    panel.menuIndex,
    BACK_ITEM,
    "the highlight stands on BACK TO SELECT, the second of the two items a loaded challenge offers",
  );

  await captureReplay(h, "select", async () => {
    await pressAction(h, "confirm");
    await h.advance(1);
  });

  const left = await h.snapshot();
  assertEqual(
    left.screen,
    "select",
    "BACK TO SELECT goes to select, from a loaded challenge's panel like any other",
  );
  assertEqual(
    left.mode,
    "extras",
    "and the list it goes to is the current state.mode's rather than a default",
  );
});
