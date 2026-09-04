// Refract — pointer/targets-listed-per-screen: every screen reports the pointer
// targets specs/controls.md fixes for it.
//
// The targets are the geometry a player aims at, so the ids and their order are
// specification, not presentation: `menu-0` through `menu-2` on the title, one
// per entry of TITLE_ITEMS; `back` on how-to; `board-1` through `board-24` and
// then `back` on select; `clear` and then `back` on playing. A build that
// reports a different set has either not built the targets or named them
// something a player-driving check cannot find, and both are the same failure.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { CAMPAIGN_LENGTH } from "../notation";
import { R9_UNIQUE } from "../fixtures";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  startCampaign,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The ids the screen reports, in the reported order. */
function ids(targets: readonly { id: string }[]): string[] {
  return targets.map((target) => target.id);
}

it("reports the fixed target ids on every screen that carries them", async () => {
  await resetTo(h, 1);

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertDeepEqual(
    ids(title.targets),
    TITLE_ITEMS.map((_item, index) => `menu-${index}`),
    "the title carries one menu-<i> target per TITLE_ITEMS entry, in order " +
      "(specs/controls.md, Pointer targets)",
  );
  captureStill(h, "title");

  await startCampaign(h);
  const select = h.snapshot();
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
  const playing = h.snapshot();
  assertEqual(playing.screen, "playing");
  assertDeepEqual(
    ids(playing.targets),
    ["clear", "back"],
    "playing carries clear and then back (specs/controls.md, Pointer targets)",
  );
});
