// screens/title-shows-mode-label — the title screen names the deal mode.
//
// specs/screens.md fixes a deal-mode label among the title screen's elements —
// `DEAL_MODE_LABEL`, "this build's label, as `specs/stock.md` states" — and
// requires that it "is drawn somewhere on the screen so a player sees which deal
// the game is played with". specs/instrumentation.md reports that same label as
// the snapshot's `dealModeLabel`.
//
// THE LABEL IS THE BUILD'S OWN, TAKEN FROM THE BUILD. What is compared is what
// the frame DREW against what the build REPORTS, so the point decides one thing —
// the screen names the deal mode this build plays — under either variant and
// without this file knowing which. A build that draws `DRAW ONE` while reporting
// `draw-three` fails here whichever of the two it meant, and the LITERAL each
// variant owes (`DRAW ONE`, `DRAW THREE`) is the variant's own point.
//
// THE REPORTED LABEL IS CHECKED FIRST, because an empty string is drawn by every
// frame that draws any text at all: a build reporting nothing would otherwise
// satisfy the match without naming anything. specs/stock.md fixes a non-empty
// label under both deal modes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { drewText } from "../case-harness/text";
import { captureStill, createHarness, resetTo, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the deal-mode label the build reports on its title screen", async () => {
  resetTo(h);
  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "posing: reset restores the title screen, which is the screen this point " +
      "reads (specs/instrumentation.md)",
  );
  assertGreaterThan(
    opened.dealModeLabel.trim().length,
    0,
    "the length of the deal-mode label the build reports, which is the text " +
      "the title screen owes a player (specs/stock.md, specs/screens.md)",
  );

  const calls = await h.drawFrame();
  captureStill(h, "title");

  assertEqual(
    drewText(calls, opened.dealModeLabel),
    true,
    `the title screen's frame to draw the deal-mode label the build reports, ` +
      `${JSON.stringify(opened.dealModeLabel)} (specs/screens.md)`,
  );
});
