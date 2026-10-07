// presentation/overlay-shown-by-backquote — the backtick key shows the debug
// overlay.
//
// specs/instrumentation.md § Diagnostics, for a build on no engine: "The
// overlay is part of the runtime layer you write. It draws the registered
// sources, IT IS SHOWN AND HIDDEN BY THE BACKTICK KEY (`KeyboardEvent.code`
// `Backquote`), it is off until toggled, and it reads the game without changing
// it."
//
// So this point is the first half of that toggle: one press puts the panel on
// the stage. Taking it off again is `overlay-hidden-by-a-second-backquote`, so
// a build whose panel appears and then will not leave passes here and fails
// there.
//
// THE READING IS THE FRAME'S OWN ACCOUNT OF THE PANEL, which the same section
// fixes exactly: "Each line the overlay draws while it is shown comes back
// through `drawn()` as a `text` entry named `overlay`, carrying that line as its
// `text`, so a caller reads the panel without reading pixels." Where a build
// puts its panel, what it says on it and what it looks like are its own — the
// specification asks only that it be "visually plain and clearly separate from
// the game's own display" — so what is decided here is that the press puts lines
// on the stage where there were none.
//
// IT IS TAKEN ON A STILL SCREEN. The build screen of an emptied site is drawn
// from state that nothing is changing: "Off the run screen nothing ticks"
// (specs/instrumentation.md § The clock), no run is under way and no pointer or
// key is held. The press itself is `keyDown`, a frame, `keyUp`, which is the
// press a build reading held keys at the top of a frame and one latching the
// event both see.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The key the specification names, as a `KeyboardEvent.code`. */
const TOGGLE = "Backquote";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the overlay on the backtick key", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).screen,
    "build",
    "the screen this reading is taken on, which nothing is ticking on " +
      "(specs/instrumentation.md § The clock)",
  );

  assertLength(
    await h.diagnostics(),
    0,
    "the overlay lines reported before the key is pressed, on a screen where " +
      "nothing else is changing: the overlay is off until toggled " +
      "(specs/instrumentation.md § Diagnostics)",
  );

  await h.press(TOGGLE);
  await h.advance(1);
  const shown = await h.diagnostics();
  await h.capture("on", "The stage with the overlay shown");

  assertTrue(
    shown.length > 0,
    `the overlay lines the frame reports once ${TOGGLE} has been pressed: ` +
      "the overlay is shown by the backtick key and draws the diagnostic " +
      "sources the specification asks a build to register, each line coming " +
      "back through drawn() as a text entry named overlay " +
      "(specs/instrumentation.md § Diagnostics)",
  );
});
