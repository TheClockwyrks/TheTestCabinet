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
import { assertEqual, assertLength, assertNotNull } from "../assert";
import {
  captureStill,
  cardSpec,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  topOf,
  type CascadeSnapshot,
  type Harness,
  type PileKind,
} from "../harness";
import { CASCADE_DEBUG_VERSION, REQUIRED_OPS } from "../surface";

/** The one card the liveness pose puts on the table, and the column it goes in. */
const CARD = "AS";
const COLUMN = 2;

/** The foundation it is then moved to: an empty one, which accepts an Ace. */
const FOUNDATION = 1;

/** The named pile's top card as a spec, or `null` where it holds none. */
function topSpec(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index: number,
): string | null {
  const top = topOf(snapshot, pile, index);
  return top === null ? null : cardSpec(top);
}

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

it("carries the version and every specified operation, as functions", () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  assertEqual(typeof api.version, "number", "version is a plain number");
  assertEqual(api.version, CASCADE_DEBUG_VERSION, "CASCADE_DEBUG_VERSION");
  for (const op of REQUIRED_OPS) {
    assertEqual(
      typeof api[op],
      "function",
      `specs/instrumentation.md names ${op} as an operation of the surface`,
    );
  }
});

it("is live: a posed card reads back and a posed move applies", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [CARD]);

  // The card the pose asked for is on the column the pose named, so the surface
  // is writing to the game that is actually running.
  assertEqual(
    topSpec(h.snapshot(), "tableau", COLUMN),
    CARD,
    `addCard must put ${CARD} on tableau ${COLUMN} (specs/instrumentation.md)`,
  );

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = h.snapshot();

  // The posed card and the applied move, as the build drew them.
  await h.advance(1);
  captureStill(h, "live");

  assertEqual(
    accepted,
    true,
    `move must apply ${CARD} onto empty foundation ${FOUNDATION}, which ` +
      "accepts an Ace of any suit (specs/foundations.md)",
  );
  assertEqual(
    topSpec(after, "foundation", FOUNDATION),
    CARD,
    `foundation ${FOUNDATION} after the move the surface drove`,
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    0,
    `tableau ${COLUMN}, which the moved card has left`,
  );
});
