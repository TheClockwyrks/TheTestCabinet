// Meltdown — controls/confirm-key: Enter takes the highlighted row.
//
// specs/controls.md binds `confirm` to `Enter` and gives it the effect "Takes the
// highlighted row." specs/screens.md says it again for every menu in the game —
// "`confirm` takes the highlighted row" — and says where the title menu's first
// row leads: of the two rows of `TITLE_ITEMS`, `PLAY` leads to `modeselect`, and
// "It starts no game of its own."
//
// WHY THIS ITEM IS CAPPED `broken` AND NAMES EVERY FUNCTIONAL DOMAIN. Every route
// into a run passes through a confirm: the title menu, the mode list, the
// difficulty list. A build whose confirm does nothing opens on its title screen
// and stays there forever, so its heat model, its defence, its run and its
// presentation are all unreachable — and since a run's functional rating is the
// worst across the domains in play, an item naming presentation alone would leave
// such a build carrying a flawless heat, defence and run rating.
//
// THE TITLE MENU IS THE ONE READ, because it is the first confirm a player makes
// and the one that needs nothing posed to reach. Where each of the other menus'
// rows leads is `screens.title-to-mode-select`,
// `screens.containment-opens-difficulty-select`,
// `screens.special-mode-starts-immediately` and
// `screens.difficulty-starts-the-run`; the four of them read the destinations, and
// this one reads that the KEY reaches the action at all. The two overlap on
// purpose: a build that answers no confirm key fails both, and one whose title row
// leads somewhere odd fails only the screens item.
//
// THE HIGHLIGHT IS POSED, NOT WALKED. `setMenuIndex` sets the highlighted row
// outright (specs/instrumentation.md), so a build whose `up`/`down` keys are
// broken still gets a fair reading of its confirm — those keys are
// `controls.menu-down` and `controls.menu-up`. Row `0` is `PLAY`, the first of
// `TITLE_ITEMS`.
//
// THE GAME IS POSED AT ITS TITLE SCREEN, from a reset, so nothing a previous
// scenario did is standing: specs/instrumentation.md has `reset` restore `screen`
// to `"title"` and `menuIndex` to `0`, and both are posed again outright so the
// precondition rests on the pose rather than on `reset` being right.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key specs/controls.md binds `confirm` to, and the only one. */
const KEY = BINDINGS.confirm;

/** The row confirmed: `PLAY`, the first of the two `TITLE_ITEMS`. */
const ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens mode select when Enter is pressed on the title menu's first row", async () => {
  await h.debug.reset();
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(ROW);
  await h.advance(1);
  const before = await h.snapshot();
  assertEqual(before.screen, "title", "the screen the scenario is posed on");
  assertEqual(before.menuIndex, ROW, "the row the scenario is posed on");

  await h.tap(KEY);
  await h.advance(1);
  const after = await h.snapshot();
  await captureStill(h, "confirmed");

  assertEqual(
    after.screen,
    "modeselect",
    `${KEY}: the screen one press takes row ${ROW} of ${TITLE_ITEMS.length} on the title menu to`,
  );
});
