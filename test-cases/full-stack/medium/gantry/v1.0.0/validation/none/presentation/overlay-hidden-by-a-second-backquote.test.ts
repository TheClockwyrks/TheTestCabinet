// presentation/overlay-hidden-by-a-second-backquote — a second backtick press
// hides the debug overlay again.
//
// specs/instrumentation.md § Diagnostics, for a build on no engine: "The
// overlay is part of the runtime layer you write. It draws the registered
// sources, IT IS SHOWN AND HIDDEN BY THE BACKTICK KEY (`KeyboardEvent.code`
// `Backquote`), it is off until toggled, and it reads the game without changing
// it."
//
// So this point is the second half of that toggle: with the panel up, the next
// press takes it off again, leaving the picture the game was drawing.
//
// AND IT ASKS NOTHING OF THE FIRST PRESS. The press that raises the panel is
// setup here, carrying no assertion and no capture: a build that draws no
// overlay at all passes this point vacuously and fails
// `overlay-shown-by-backquote`, which is the point that names that defect.
// Asserting the panel appeared would grade a build that never draws one exactly
// as hard as one that shows a panel it will not hide, which is the collapse the
// two points were split to avoid.
//
// THE READING IS THE FRAME'S OWN ACCOUNT OF THE PANEL, which the same section
// fixes exactly: "Each line the overlay draws while it is shown comes back
// through `drawn()` as a `text` entry named `overlay`, carrying that line as its
// `text`, so a caller reads the panel without reading pixels." A hidden panel
// draws no line, so a frame after the second press reports none.
//
// IT IS TAKEN ON A STILL SCREEN. The build screen of an emptied site is drawn
// from state that nothing is changing: "Off the run screen nothing ticks"
// (specs/instrumentation.md § The clock), no run is under way and no pointer or
// key is held. The press itself is `keyDown`, a frame, `keyUp`, which is the
// press a build reading held keys at the top of a frame and one latching the
// event both see.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
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

it("hides the overlay on a second backtick press", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).screen,
    "build",
    "the screen this reading is taken on, which nothing is ticking on " +
      "(specs/instrumentation.md § The clock)",
  );

  // Setup, and nothing is asked of it: putting the panel up is the other point.
  await h.press(TOGGLE);
  await h.advance(1);

  await h.press(TOGGLE);
  await h.advance(1);
  const hidden = await h.diagnostics();
  await h.capture("off-again", "The stage after a second backtick press");

  assertLength(
    hidden,
    0,
    `the overlay lines the frame reports once ${TOGGLE} has been pressed a ` +
      "second time: the backtick key hides the overlay again, leaving the " +
      "game's own display, and a hidden panel draws no line for drawn() to " +
      "report (specs/instrumentation.md § Diagnostics)",
  );
});
