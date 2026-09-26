// presentation/overlay-off-until-toggled — the debug overlay is not drawn until
// the backtick key is pressed.
//
// specs/instrumentation.md § Diagnostics, for a build on no engine: "The overlay
// is part of the runtime layer you write. It draws the registered sources, it is
// shown and hidden by the backtick key (`KeyboardEvent.code` `Backquote`), IT IS
// OFF UNTIL TOGGLED, and it reads the game without changing it." So what a player
// sees on load is the game's own display and nothing else.
//
// THE READING IS THE FRAME'S OWN ACCOUNT OF THE PANEL. The same section fixes it
// exactly: "Each line the overlay draws while it is shown comes back through
// `drawn()` as a `text` entry named `overlay`, carrying that line as its `text`,
// so a caller reads the panel without reading pixels. It is the one `text` entry
// whose `name` this file fixes." So the panel is up exactly when the frame
// reports `overlay` lines, and a build's own choice of where to put its panel,
// what to say on it and what it looks like never enters into it.
//
// THE READING IS TAKEN WHERE THE GAME LOADS, on the title screen, before any
// input reaches the game. The harness has pressed one key the game binds to
// nothing (specs/controls.md) to arm the page's audio, and nothing else.
//
// THE PRESS IS THE SECOND HALF. A build that reports no lines either side would
// pass a check that only looked at the load, so the same press this point is
// about is made and the panel must then be reporting: the state before the press
// is the off state because the press turns it on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { createHarness, type Harness } from "../harness";

/** The key the specification names, as a `KeyboardEvent.code`. */
const TOGGLE = "Backquote";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws no overlay before the backtick key is pressed", async () => {
  await h.advance(1);
  await h.capture("off", "The stage with the overlay hidden");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen a loaded game stands on, which this reading is taken on " +
      "(specs/ui.md § Title)",
  );

  const before = await h.diagnostics();
  assertLength(
    before,
    0,
    "the overlay lines the loaded game's first frame reports, before any " +
      "key has reached it: the overlay is off until toggled, and each line it " +
      "draws while it is shown comes back through drawn() as a text entry " +
      "named overlay (specs/instrumentation.md § Diagnostics)",
  );

  await h.press(TOGGLE);
  await h.advance(1);

  const after = await h.diagnostics();
  assertTrue(
    after.length > 0,
    `the overlay to report its lines once ${TOGGLE} has been pressed, which ` +
      "is what makes the frame before the press an OFF state rather than a " +
      "build that draws no overlay at all (specs/instrumentation.md " +
      "§ Diagnostics)",
  );
});
