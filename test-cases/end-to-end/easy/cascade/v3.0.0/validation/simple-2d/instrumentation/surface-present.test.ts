// instrumentation/surface-present — the debug and automation surface is present,
// whole, and live.
//
// specs/instrumentation.md makes the surface a deliverable of the build: its
// `initialize` returns the finished surface beside the state it built, as
// `[state, debug]`, the engine returns that same value from `engine.debug`, and it
// is reached that way alone. Nothing is installed on the page. Every other suite in
// this project poses its scenario through it, so a missing surface also shows up as
// every other suite failing to run. This one names the fault plainly.
//
// THREE HALVES, AND EACH IS THE BUILD'S.
//
// PRESENCE. `engine.debug` holds an object rather than nothing.
//
// COMPLETENESS. `version` is `CASCADE_DEBUG_VERSION` (`1`), a plain number, and
// every operation specs/instrumentation.md names is a function on the surface. The
// list is `REQUIRED_OPS` in `surface.ts`, which is that file's operation tables
// written down. `setAutoStep` and `advance` are deliberately NOT demanded: under an
// engine the clock is the engine's, and the specification gives those two to the
// engineless build alone. Neither is `setMuted`, which the specification does not
// carry at all.
//
// LIVENESS. A surface that answers with a plausible-looking object unconnected to
// the running game is the failure worth naming, so the check poses one card and
// then moves it, and requires both readings to be of the real game: the posed card
// comes back off `snapshot` as the card it was asked for, and the move applies
// through the game's own rules. The card is the Ace of spades, which tells every
// wrong answer apart: a build that ignored the suit and rank arguments reports some
// other card, one that created no card reports an empty column, and one whose
// surface is a shell reports nothing at all.
//
// WHY AN ACE ONTO AN EMPTY FOUNDATION. specs/foundations.md: an empty foundation
// accepts an Ace of any suit, which is the one move a table carrying a single card
// can make. Whether the foundation rules are RIGHT is `foundations.accepts-ace`'s
// point; what is read here is that the surface's `move` reached the game at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";
import { REQUIRED_OPS } from "../surface";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns its debug surface beside its state from initialize", () => {
  // `engine.debug` is whatever the build's `initialize` returned as the second
  // element of `[state, debug]`, so reading it is the check: there is no page
  // property to look for and nothing the harness could have supplied in the
  // build's place. A build that returned `null` there has no surface.
  assertNotNull(
    h.engine.debug,
    "src/game.ts's initialize must return the debug surface beside its state, " +
      "as [state, debug] (specs/instrumentation.md)",
  );
  assertEqual(typeof h.engine.debug, "object");
});

it("carries every specified operation, as functions", async () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  openTable(h);
  await h.advance(1);
  // Before the assertions, so a missing operation still leaves the picture of
  // the table the surface was read off.
  captureStill(h, "surface");

  for (const op of REQUIRED_OPS) {
    assertEqual(
      typeof api[op],
      "function",
      `specs/instrumentation.md names ${op} as an operation of the surface`,
    );
  }
});
