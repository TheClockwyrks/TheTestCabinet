// screens/title-shows-mode-label — the title screen names the deal mode this
// build plays, and names it as the build itself reports it.
//
// THE RULE. specs/screens.md gives the title screen a Deal-mode label,
// `DEAL_MODE_LABEL`, whose content is "this build's label, as specs/stock.md
// states", and requires it drawn "somewhere on the screen so a player sees which
// deal the game is played with". specs/instrumentation.md has the snapshot report
// that same figure as `dealModeLabel`.
//
// SO THIS POINT DECIDES CONSISTENCY, NOT THE LITERAL. What is asserted is that the
// label the build DRAWS is the label the build REPORTS, which is a requirement
// under both variants and all three engines. The literal each variant owes —
// `DRAW ONE` here, `DRAW THREE` there — is the variant's own point,
// `draw-one/mode-label-title`. A build consistent about the wrong label loses that
// point and keeps this one; a build that reports the right label and draws nothing
// loses this one.
//
// THE REPORTED LABEL IS READ FIRST, AND IT MUST BE A LABEL. specs/stock.md fixes
// `DEAL_MODE_LABEL` as a non-empty literal, and a substring match against an empty
// string would hold against any text at all, so a build reporting nothing is
// failed here rather than passed vacuously.
//
// THE SCREEN IS POSED with `setScreen("title")`, which changes nothing else
// (specs/instrumentation.md); `clearTable` empties the piles the specification
// lets show behind it, so every run of text the frame draws belongs to the screen.
//
// WHAT THIS DOES NOT DECIDE. The same consistency during play, which is
// `screens/hud-shows-mode-label`: a build right on the title and wrong in the HUD
// misses one requirement, not both.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewText,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the deal-mode label the snapshot reports on the title screen", async () => {
  h.debug.setScreen("title");
  h.debug.clearTable();
  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: the game is on the title screen the frame below draws " +
      "(specs/instrumentation.md)",
  );

  const label = h.snapshot().dealModeLabel;
  const calls = await drawFrame(h);
  captureStill(h, "title");

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
    `the title screen's frame drawing the deal-mode label the build itself ` +
      `reports (${label}) (specs/screens.md)`,
  );
});
