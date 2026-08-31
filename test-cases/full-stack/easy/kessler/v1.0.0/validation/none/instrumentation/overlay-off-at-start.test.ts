// instrumentation/overlay-off-at-start — a fresh build draws no overlay until
// the backtick first shows it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md (Diagnostics): the
// overlay "is off when the game starts".
//
// HOW IT IS READ. Off a fresh reset, on the boot title screen, the first
// backtick press must SHOW the panel — its text arrives on top of everything
// the title was already drawing, and nothing the title drew goes away. A build
// that boots with the overlay visible fails both halves at once: its first
// press hides the panel, so lines that were stable before the press are gone
// after it. Frames are read in stable pairs, so anything a build animates from
// frame to frame decides nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { TITLE_COPY } from "../constants";
import { captureStill, openHarness, type Harness } from "../harness";
import { frameText, minusLines, pressToggle, stableLines } from "./overlay";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws no overlay before the first backtick press", async () => {
  await h.reset();
  const bootStable = stableLines(await frameText(h), await frameText(h));
  await captureStill(h, "fresh");
  assertTrue(
    bootStable.some((line) =>
      line.toLowerCase().includes(TITLE_COPY.toLowerCase()),
    ),
    "the boot frame carrying the title",
  );

  await pressToggle(h);
  const shownStable = stableLines(await frameText(h), await frameText(h));

  // The first press added the panel's lines and removed none of the boot's.
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
});
