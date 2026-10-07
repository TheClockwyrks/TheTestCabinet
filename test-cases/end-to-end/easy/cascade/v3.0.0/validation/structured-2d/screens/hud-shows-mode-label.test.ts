// screens/hud-shows-mode-label — the HUD names the deal mode during play.
//
// specs/screens.md: "`DEAL_MODE_LABEL` is drawn in the strip as well, so the deal
// mode is visible throughout play." A player who left the title screen behind
// still has to be able to see which deal the game in front of them is played
// with, and the HUD is where specs/screens.md puts that answer.
//
// THE LABEL IS THE BUILD'S OWN, TAKEN FROM THE BUILD. What the frame drew is
// compared against what the snapshot reports as `dealModeLabel`
// (specs/instrumentation.md), so this point decides that the two agree under
// either variant. The LITERAL each variant owes is the variant's own point, and
// the title screen's copy of the label is
// `screens/title-shows-mode-label` — a build that names the mode on one screen
// and not the other grades apart from one that names it nowhere.
//
// THE TABLE IS EMPTY, because the HUD is drawn on the `playing` screen and owes
// nothing to what is on the table (specs/screens.md). Dealing a game first would
// put fifty-two cards of drawing between the check and the one run of text it
// reads, and would fail this point on a build whose deal is broken.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { drewText } from "../case-harness/text";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the deal-mode label the build reports in the HUD during play", async () => {
  openTable(h);
  const playing = h.snapshot();
  assertEqual(
    playing.screen,
    "playing",
    "posing: the live table, which is the screen the HUD is drawn on " +
      "(specs/screens.md)",
  );
  assertGreaterThan(
    playing.dealModeLabel.trim().length,
    0,
    "the length of the deal-mode label the build reports, which is the text " +
      "the HUD owes a player (specs/stock.md, specs/screens.md)",
  );

  const calls = await h.drawFrame();
  captureStill(h, "hud");

  assertEqual(
    drewText(calls, playing.dealModeLabel),
    true,
    `a frame of live play to draw the deal-mode label the build reports, ` +
      `${JSON.stringify(playing.dealModeLabel)} (specs/screens.md)`,
  );
});
