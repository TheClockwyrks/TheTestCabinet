// Carom — ui/state-howto: How to Play is reachable from the menu and draws a
// screen of its own.
//
// The menu is navigated with real key events — two moves down to the third entry,
// then confirm — so what opens the screen is the build's own menu handling
// through the actions the case binds, not a state assignment.
//
// What is asserted about the screen itself is deliberately narrow. The
// specification fixes no copy for it ("a simple screen describing the controls
// and the spin and obstacle mechanics"), so this asserts that it is a real screen
// — a meaningful amount of text, and not simply the title menu redrawn — and
// leaves whether it reads well to the reviewer looking at the capture.

import { afterEach, beforeEach, expect, it } from "vitest";
import { createHarness, drawnText, type Harness } from "../harness";

/** Enough text that the screen explains something rather than being a stub. */
const MIN_CHARACTERS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens the how-to-play screen from the menu", async () => {
  h.calls.length = 0;
  await h.advance(1);
  const title = drawnText(h.calls).join(" ");

  await h.tap("ArrowDown"); // SOLO -> VERSUS
  await h.tap("ArrowDown"); // VERSUS -> HOW TO PLAY
  await h.tap("Enter");

  h.calls.length = 0;
  await h.advance(1);

  expect(h.snapshot().screen).toBe("howto");

  const howto = drawnText(h.calls);
  expect(howto.join("").length).toBeGreaterThanOrEqual(MIN_CHARACTERS);
  expect(howto.join(" ")).not.toBe(title);
});
