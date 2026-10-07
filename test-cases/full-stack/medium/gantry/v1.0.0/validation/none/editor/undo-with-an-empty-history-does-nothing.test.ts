// editor/undo-with-an-empty-history-does-nothing — an undo on a site opened and
// not yet edited changes nothing.
//
// `specs/structure.md` § The editor's rules bounds the history: "undo restores
// the structure to what it was before the most recent structure-changing edit,
// **as far back as the site was opened**". `specs/state.md` says what opening a
// site does to it — "empties `history`" — and `specs/instrumentation.md` fixes
// the reading that reports it: `historyDepth` is "`0` on a site opened and not
// yet edited". So there is nothing behind the site opening to reach, and the
// undo has nothing to do.
//
// The scenario is the spec sentence itself: a site opened, nothing built, and the
// undo action pressed on the build screen where `specs/controls.md` binds it.
// Nothing is cleared or posed first, because any pose would be the edit whose
// absence is the whole point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves an unedited site's empty structure and empty history alone", async () => {
  await openSite(h, 0);

  const opened = await h.snapshot();
  assertEqual(
    opened.historyDepth,
    0,
    "historyDepth on a site opened and not yet edited " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    opened.screen,
    "build",
    "the screen the site opening shows, where `undo` applies " +
      "(specs/controls.md)",
  );

  await h.press(BINDINGS.undo[0]!);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("unchanged", "The empty site the undo left alone");

  assertEqual(
    s.historyDepth,
    0,
    "historyDepth after an undo with an empty history (specs/structure.md)",
  );
  assertLength(
    s.structure.members,
    0,
    "the members after an undo with an empty history",
  );
  assertNull(s.structure.ring, "the ring after an undo with an empty history");
  assertLength(
    s.structure.counterweights,
    0,
    "the counterweights after an undo with an empty history",
  );
});
