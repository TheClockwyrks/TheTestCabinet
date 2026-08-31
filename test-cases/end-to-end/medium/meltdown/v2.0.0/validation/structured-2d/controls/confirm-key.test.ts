// Meltdown — controls/confirm-key: Enter takes the highlighted row.
//
// THE RULE. specs/controls.md binds `confirm` to `Enter` (The bindings) and gives
// it the effect "Takes the highlighted row" (The actions). specs/screens.md says
// it again for every menu — "`confirm` takes the highlighted row" — and says where
// the title menu's first row leads: of the two rows of `TITLE_ITEMS`, `PLAY` leads
// to `modeselect`, and "It starts no game of its own."
//
// WHY THE CAP IS `broken` AND EVERY FUNCTIONAL DOMAIN IS NAMED. Every route into a
// run passes through a confirm: the title menu, the mode list, the difficulty
// list. A build whose confirm does nothing opens on its title screen and stays
// there forever, so its heat model, its defence, its run and its presentation are
// all unreachable — and a run's functional rating is the worst across the domains
// in play, so an item naming presentation alone would leave such a build carrying
// a flawless heat, defence and run.
//
// THE TITLE MENU IS THE ONE READ, because it is the first confirm a player makes
// and the one that needs nothing posed to reach. Where each of the other menus'
// rows leads is `screens.title-to-mode-select`,
// `screens.containment-opens-difficulty-select`,
// `screens.special-mode-starts-immediately` and
// `screens.difficulty-starts-the-run`; those four read the destinations, and this
// one reads that the KEY reaches the action at all.
//
// THE HIGHLIGHT IS POSED, NOT WALKED. `setMenuIndex` sets the highlighted row
// outright (specs/instrumentation.md), so a build whose arrow keys are broken
// still gets a fair reading of its confirm — those keys are `controls.menu-down`
// and `controls.menu-up`. Row `0` is `PLAY`, the first of `TITLE_ITEMS`.
//
// THE SCREEN AND THE ROW ARE BOTH POSED OUTRIGHT after a reset, so the
// precondition rests on the pose rather than on `reset` being right.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, resetTo, type Harness } from "../harness";

/** The key specs/controls.md binds `confirm` to, as a `KeyboardEvent.code`. */
const KEY = "Enter";

/** The row confirmed: `PLAY`, the first of the two `TITLE_ITEMS`. */
const ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens mode select when Enter is pressed on the title menu's first row", async () => {
  resetTo(h);
  h.debug.setScreen("title");
  h.debug.setMenuIndex(ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the scenario is posed on");
  assertEqual(before.menuIndex, ROW, "the row the scenario is posed on");

  await h.tap(KEY);
  captureStill(h, "confirmed");

  assertEqual(
    h.snapshot().screen,
    "modeselect",
    `${KEY}: the screen one press takes row ${ROW} of ${TITLE_ITEMS.length} on the title menu to`,
  );
});
