// Floe — controls/overlay-backquote: the backtick key shows the debug overlay
// and a second press hides it, and neither press changes the game.
//
// `specs/controls.md` fixes the binding — "The backtick key (`Backquote`) shows
// and hides the debug overlay, which is part of the runtime layer you write" —
// and `specs/instrumentation.md` fixes the rest of the contract under this
// engine: the overlay "draws the registered sources, it is hidden when the game
// starts, it is shown and hidden by the backtick key ... and it reads the game
// without changing it."
//
// SO THIS POINT IS THE TOGGLE, IN BOTH DIRECTIONS, PLUS ITS PURITY. Showing and
// hiding are the two halves of one binding, and a build that shows the overlay
// and cannot put it away has implemented half of it. The purity is read ACROSS
// BOTH presses rather than beside them because it is a property of the toggle
// rather than of the panel: an overlay whose toggle disturbs what the game
// reports is not a read-only overlay, whichever way it was toggled. What the
// panel must actually SAY is `instrumentation.overlay`'s point, not this one's,
// and a build that draws the wrong facts loses that one and keeps this.
//
// HOW "SHOWN" AND "HIDDEN" ARE READ. The recorder hands back every operation one
// frame's render issued, so the overlay's presence is read as the TEXT that
// frame drew: the overlay draws the registered sources, and every one of them is
// a line of text over the finished picture. The baseline is the same frame with
// the overlay away — the HUD's own readouts, which `specs/ui.md` fixes as five
// and which hold still throughout, because the strait under this check is
// cleared and every world gate is shut. Showing the overlay must therefore add
// text draws, and hiding it must take exactly those away again: the count
// returns to the baseline's. Nothing here asserts WHICH text, or how much of it,
// so a build is free to lay its panel out however it likes.
//
// THE PURITY IS READ OVER EVERY SNAPSHOT FIELD BUT `simTime`. Delivering a press
// takes a tick — a key must be genuinely held while one runs to be seen — and
// `specs/instrumentation.md` says `simTime` "adds `TICK_DT` on every tick
// whatever the screen", so it moves whether or not anything was pressed.
// Everything else the snapshot reports is the game's own and must be exactly as
// it was, `muted` included: a build whose backtick key also muted the game would
// be caught here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  startCrossing,
  toggleOverlay,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/**
 * The snapshot fields that differ between two readings, `simTime` apart.
 *
 * A whole-snapshot comparison would report the difference as two four-thousand
 * character objects, and `assert.ts` asks a failure to be a pair a reviewer can
 * read. So the comparison is the same one — every field but `simTime`, compared
 * by value — and what it reports is the NAMES of the fields that moved, which is
 * exactly what a build that answered to the key got wrong.
 */
function driftedFields(before: FloeSnapshot, after: FloeSnapshot): string[] {
  const fields = Object.keys(before) as (keyof FloeSnapshot)[];
  return fields
    .filter((field) => field !== "simTime")
    .filter(
      (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
    );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the overlay on Backquote, hides it on the next, and changes nothing either time", async () => {
  await startCrossing(h);

  // The baseline frame first, and the state it left second, so the comparison
  // below spans the two toggles and nothing else.
  const baseline = drawnText(await h.frameCalls());
  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the pose opened a live crossing");

  await toggleOverlay(h);
  const shown = drawnText(await h.frameCalls());
  await captureStill(h, "overlay");
  const withOverlay = await h.snapshot();

  await toggleOverlay(h);
  const hidden = drawnText(await h.frameCalls());
  const afterHiding = await h.snapshot();

  assertGreaterThan(
    shown.length,
    baseline.length,
    "Backquote shows the overlay: the frame draws the registered sources it was not drawing before (specs/controls.md)",
  );
  assertEqual(
    hidden.length,
    baseline.length,
    "a second Backquote hides it again, leaving the frame drawing what it drew before (specs/controls.md)",
  );
  assertDeepEqual(
    driftedFields(before, withOverlay),
    [],
    "showing the overlay reads the game without changing it (specs/instrumentation.md)",
  );
  assertDeepEqual(
    driftedFields(before, afterHiding),
    [],
    "and neither does hiding it (specs/instrumentation.md)",
  );
});
