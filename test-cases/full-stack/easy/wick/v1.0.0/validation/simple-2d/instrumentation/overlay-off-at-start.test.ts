// instrumentation/overlay-off-at-start — a freshly started build draws no
// debug overlay until the backtick key first shows it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md (Diagnostics): the
// overlay is the engine's, toggled by the backtick, and the game "registers
// the values it reports as diagnostic sources"; the engine's own diagnostics
// documentation: "The overlay is hidden when the engine is created".
// specs/ui.md: "The game opens here", the title, showing TITLE_TEXT.
//
// HOW IT IS READ. Off a fresh reset on the boot title, the first backtick
// press must SHOW the panel: its text arrives on top of everything the title
// was drawing and nothing the title drew goes away. A build that boots with
// the overlay visible fails both halves at once: its first press hides the
// panel, so lines that were stable before the press are gone after it. Frames
// are read in stable pairs, so anything a build animates decides nothing.
//
// AND WHAT THE BOOT FRAME MAY NOT ALREADY BE REPORTING. The three readings
// above are all satisfied by a build that paints a debug panel of its OWN on
// every frame, because the engine's panel still arrives on top of it. So the
// press's lines are read for which of the build's REGISTERED diagnostic names
// they report — the names come off `diagnostics()`, the build's own list, not
// off any format this case fixes — and the boot frame is required to report
// none of them. A build reading its state onto the screen before the toggle
// has ever been pressed fails here whether or not it also asks the engine for
// its panel.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  hasToken,
  minusLines,
  pressToggle,
  type Harness,
} from "../harness";
import { frameText, stableLines } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws no overlay before the first backtick press", async () => {
  h.reset();
  const bootStable = stableLines(await frameText(h), await frameText(h));
  captureStill(h, "fresh");
  assertTrue(
    bootStable.some((line) =>
      line.toLowerCase().includes(TITLE_TEXT.toLowerCase()),
    ),
    "the boot frame carrying the title",
  );

  await pressToggle(h);
  const shownStable = stableLines(await frameText(h), await frameText(h));

  assertGreaterThan(
    shownStable.length,
    bootStable.length,
    "stable text after the first press",
  );
  assertEqual(
    minusLines(bootStable, shownStable).length,
    0,
    "boot lines the first press took away",
  );

  const added = minusLines(shownStable, bootStable);
  const reported = h
    .diagnostics()
    .map((reading) => reading.name)
    .filter((name) => hasToken(added, name));
  assertGreaterThan(
    reported.length,
    0,
    "registered diagnostic names the first press put on the screen",
  );
  assertEqual(
    bootStable.filter((line) => reported.some((name) => hasToken([line], name)))
      .length,
    0,
    "boot lines already reporting a registered diagnostic, before any press",
  );
});
