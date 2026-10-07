// Refract — pointer/targets-listed-per-screen: every screen reports the pointer
// targets specs/controls.md fixes for it.
//
// The targets are the geometry a player aims at, so the ids and their order are
// specification, not presentation: `menu-0` through `menu-2` on the title, one
// per entry of TITLE_ITEMS; `back` on how-to; `board-1` through `board-24` and
// then `back` on select; `clear` and then `back` on playing; one `menu-<i>` per
// choice on solved, three of them on a board that is not the last; two on
// Cascade's solved screen, one per `SOLVED_ITEMS` entry; `menu-0` and `menu-1`
// on complete. A build that reports a different set has either not built the
// targets or named them something a player-driving check cannot find, and both
// are the same failure.
//
// Every screen the walk does not arrive at in play is POSED with `setScreen`,
// which sets `state.screen` alone, and Cascade's solved screen with `setMode`
// beside it, which sets `state.mode` alone (specs/instrumentation.md), so a
// build whose menus are the broken part fails the menu points and not this one.

import { afterEach, beforeEach, it } from "vitest";
import { SOLVED_ITEMS, TITLE_ITEMS } from "../constants";
import { CAMPAIGN_LENGTH } from "../notation";
import { R9_UNIQUE } from "../fixtures";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  startCampaign,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The ids the screen reports, in the reported order. */
function ids(targets: readonly { id: string }[]): string[] {
  return targets.map((target) => target.id);
}

it("reports the fixed target ids on every screen that carries them", async () => {
  await h.debug.reset();
  await h.advance(1);

  const title = await h.snapshot();
  assertEqual(title.screen, "title");
  assertDeepEqual(
    ids(title.targets),
    TITLE_ITEMS.map((_item, index) => `menu-${index}`),
    "the title carries one menu-<i> target per TITLE_ITEMS entry, in order " +
      "(specs/controls.md, Pointer targets)",
  );
  await captureStill(h, "title");

  await h.debug.setScreen("howto");
  await h.advance(1);
  const howto = await h.snapshot();
  assertEqual(howto.screen, "howto");
  assertDeepEqual(
    ids(howto.targets),
    ["back"],
    "howto carries the back target and nothing else " +
      "(specs/controls.md, Pointer targets)",
  );

  await startCampaign(h);
  const select = await h.snapshot();
  assertEqual(select.screen, "select");
  assertDeepEqual(
    ids(select.targets),
    [
      ...Array.from({ length: CAMPAIGN_LENGTH }, (_v, i) => `board-${i + 1}`),
      "back",
    ],
    "select carries board-1 through board-24 and then back " +
      "(specs/controls.md, Pointer targets)",
  );

  await loadBoard(h, R9_UNIQUE);
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing");
  assertDeepEqual(
    ids(playing.targets),
    ["clear", "back"],
    "playing carries clear and then back (specs/controls.md, Pointer targets)",
  );

  // The posed board stays behind both screens, as specs/modes/campaign.md has
  // it. `boardIndex` rests at 0, so the solved board is board 1, which is not
  // board 24, and the next board is offered alongside the replay and the way
  // back to the grid.
  await h.debug.setScreen("solved");
  await h.advance(1);
  const solved = await h.snapshot();
  assertEqual(solved.screen, "solved");
  assertDeepEqual(
    ids(solved.targets),
    ["menu-0", "menu-1", "menu-2"],
    "solved carries one menu-<i> per choice it offers, three on a board that " +
      "is not the last (specs/modes/campaign.md, The solved screen)",
  );

  await h.debug.setScreen("complete");
  await h.advance(1);
  const complete = await h.snapshot();
  assertEqual(complete.screen, "complete");
  assertDeepEqual(
    ids(complete.targets),
    ["menu-0", "menu-1"],
    "complete carries menu-0 and menu-1, one per choice " +
      "(specs/controls.md, Pointer targets)",
  );

  // Cascade offers its own menu on the same screen, so the screen carries its
  // own set of targets there. `setMode` sets `state.mode` alone
  // (specs/instrumentation.md), which is what makes the pair reachable.
  await h.debug.setMode("cascade");
  await h.debug.setScreen("solved");
  await h.advance(1);
  const cascadeSolved = await h.snapshot();
  assertEqual(cascadeSolved.screen, "solved");
  assertDeepEqual(
    ids(cascadeSolved.targets),
    SOLVED_ITEMS.map((_item, index) => `menu-${index}`),
    "Cascade's solved screen carries one menu-<i> per SOLVED_ITEMS entry, " +
      "two of them (specs/modes/cascade.md, The solved screen)",
  );
});
