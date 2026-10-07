// instrumentation/overlay-off-at-start — a freshly started build draws no debug
// overlay until the backtick key first shows it.
//
// THE RULE, from Diagnostics in `specs/instrumentation.md`, of the engineless
// runtime's own overlay: "It draws the registered sources, the backtick key
// (`KeyboardEvent.code` `Backquote`) shows and hides it, IT IS OFF WHEN THE GAME
// STARTS, and it reads the game without changing it." Under either engine the
// panel is the engine's and starts closed there for the same reason: it is a
// diagnostic layer rather than part of the game's presentation, and a player who
// never presses the key never sees it.
//
// THE POSE IS THE GAME AS IT STANDS UP. Nothing is opened, nothing is started, and
// no key is pressed before the frame this check reads: the title screen a build
// comes up on is the fresh start the rule is about.
//
// HOW "NO OVERLAY IS DRAWN" IS DECIDED. Absence is read through the toggle, which
// is the only handle the specification gives on the panel. If the panel is off,
// the first press SHOWS it and the frame after gains the panel's lines; if it were
// already on, the first press would HIDE it and the frame after would lose them.
// So the verdict is a direction: the first press must ADD text to the frame and
// must take none away. Reading it this way needs no knowledge of where the panel
// sits, what it is styled like or what it says — only that showing a panel puts
// text on a frame and hiding one takes text off.
//
// THE EVIDENCE IS THE FRESH FRAME ITSELF, captured before the key is ever pressed,
// so a build that came up with the panel open leaves the picture that shows it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  openTitle,
  toggleOverlay,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The strings in `texts` left after removing `baseline`, as a multiset. */
function addedTexts(
  texts: readonly string[],
  baseline: readonly string[],
): string[] {
  const remaining = [...baseline];
  return texts.filter((text) => {
    const index = remaining.indexOf(text);
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}

it("comes up with no overlay, and gains one only on the first backtick press", async () => {
  await openTitle(h);
  const fresh = drawnText(await h.frameCalls());
  await captureStill(h, "fresh");
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the fresh frame is the screen the build comes up on",
  );

  await toggleOverlay(h);
  const afterFirstPress = drawnText(await h.frameCalls());

  assertGreaterThan(
    addedTexts(afterFirstPress, fresh).length,
    0,
    "the first backtick press SHOWS the overlay, so the fresh frame had none on it",
  );
  assertDeepEqual(
    addedTexts(fresh, afterFirstPress),
    [],
    "and takes nothing off the frame, so the first press did not hide a panel that was already open",
  );
});
