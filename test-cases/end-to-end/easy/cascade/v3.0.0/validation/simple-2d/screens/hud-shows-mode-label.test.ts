// screens/hud-shows-mode-label — the HUD names the deal mode throughout play, and
// names it as the build itself reports it.
//
// THE RULE. specs/screens.md's HUD section: "`DEAL_MODE_LABEL` is drawn in the
// strip as well, so the deal mode is visible throughout play."
// specs/instrumentation.md has the snapshot report that same figure as
// `dealModeLabel`.
//
// SO THIS POINT DECIDES CONSISTENCY, NOT THE LITERAL. What is asserted is that the
// label the build DRAWS during play is the label the build REPORTS, which is a
// requirement under both variants and all three engines. The literal each variant
// owes is the variant's own point, `draw-one/mode-label-hud`.
//
// THE REPORTED LABEL MUST BE A LABEL. specs/stock.md fixes `DEAL_MODE_LABEL` as a
// non-empty literal, and a substring match against an empty string would hold
// against any text at all, so a build reporting nothing is failed here rather than
// passed vacuously.
//
// THE TABLE IS EMPTY UNDER THE HUD. `openTable` opens live play with no cards on
// it, so every run of text the frame draws belongs to the HUD rather than to a
// card's rank; nothing this point reads concerns a card.
//
// WHAT THIS DOES NOT DECIDE. Where in the strip the label sits, which no point
// grades, nor the same consistency on the title screen, which is
// `screens/title-shows-mode-label`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { drewText } from "../case-harness/text";
import {
  captureStill,
  createHarness,
  drawFrame,
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

it("draws the deal-mode label the snapshot reports during play", async () => {
  openTable(h);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: the game is in live play, where the HUD is drawn " +
      "(specs/screens.md)",
  );

  const label = h.snapshot().dealModeLabel;
  const calls = await drawFrame(h);
  captureStill(h, "hud");

  assertGreaterThan(
    label.length,
    0,
    "characters in the DEAL_MODE_LABEL the snapshot reports as " +
      "dealModeLabel, which specs/stock.md fixes as a non-empty literal " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    drewText(calls, label),
    true,
    `the playing screen's frame drawing the deal-mode label the build itself ` +
      `reports (${label}) (specs/screens.md: it is drawn in the strip so the ` +
      "deal mode is visible throughout play)",
  );
});
