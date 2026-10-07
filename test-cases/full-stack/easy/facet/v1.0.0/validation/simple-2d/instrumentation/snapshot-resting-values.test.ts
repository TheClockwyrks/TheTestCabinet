// Facet — instrumentation/snapshot-resting-values: with no board in play the
// snapshot still reports every field, holding its resting value.
//
// WHY THIS IS A POINT OF ITS OWN. specs/instrumentation.md fixes the snapshot's
// shape and then adds the sentence this point is about: "The shape is fixed, and
// every field is present on every screen. A field with nothing to report holds
// its resting value rather than going missing: `board` is
// `{ cols: 0, rows: 0, cells: [] }` while no board is in play, `selection`,
// `offer`, `refusal` and `armedTarget` are `null` while none stands, `chainStep`
// and `stepTimer` are `0` while `phase` is not `resolving`, `swapTimer` is `0`
// while `phase` is not `swapping`, and `menuIndex` is live on every screen
// carrying a menu and rests at `0`." A build that builds its snapshot out of the
// board it is holding, and reports nothing when it holds none, satisfies every
// point that reads a snapshot on the `playing` screen and breaks every reader
// that looks at one anywhere else — a `board` that is `undefined` rather than
// empty, a `selection` that is simply absent. The absences are exactly what a
// shape checked only where the game is busiest never sees.
//
// THE FIGURES A ROUND MOVES ARE READ HERE TOO. `lastWaves`, `moveScore`,
// `bestMove` and `bestChain` all mean something only once a move has been played,
// and specs/instrumentation.md rests every one of them at `0`. They are read
// beside the four `null`s because they fail the same way: a build that reports
// them off the chain it is holding reports nothing at all when it holds none.
//
// `targets` IS EXEMPT, AND DELIBERATELY. The title screen carries two of them —
// specs/controls.md gives it `menu-0` and `menu-1` — so `targets` has something
// to report here rather than a resting value, and WHAT it reports is the
// `targets` category's point rather than this one's.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE. That `reset` puts the game here is
// `instrumentation/reset-restores-every-field`; what the title screen SHOWS is
// the
// `screens` points. The screen is read as the precondition — no board is in play
// — and everything asserted after it is the resting reading itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { RESTING_REFILL_KINDS } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  type Harness,
} from "../harness";

let h: Harness;

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds every field at its resting value while no board is in play", async () => {
  requireSurface();
  // The title screen, where the game stands before a round has begun: nothing is
  // selected, nothing is refused, no chain is running, and there is no board.
  captureStill(h, "title");

  const s = h.snapshot();
  assertEqual(s.screen, "title", "the screen the resting snapshot is read on");

  // The board, stated exactly as the specification states it. Read field by
  // field rather than as one object, so a build that carries an extra reading
  // of its own beside the three is not failed for it.
  assertEqual(s.board.cols, 0, "board.cols with no board in play");
  assertEqual(s.board.rows, 0, "board.rows with no board in play");
  assertDeepEqual(s.board.cells, [], "board.cells with no board in play");

  // `null` rather than missing: `assertNull` refuses `undefined` too, which is
  // the shape a build that omitted the field would report. All four of the
  // fields the specification rests at `null`, since a build can carry the
  // selection and forget the offer it is made into, or carry both and forget
  // the target a press armed.
  assertNull(s.selection, "selection with none standing");
  assertNull(s.offer, "offer with none standing");
  assertNull(s.refusal, "refusal with none standing");
  assertNull(s.armedTarget, "armedTarget with none armed");

  // No move is in motion and no chain is running, and the three timing figures
  // that only mean something while one of the two is are `0` rather than left at
  // whatever a previous move left.
  assertEqual(s.phase, "idle", "phase with no board in play");
  assertEqual(s.chainStep, 0, "chainStep while idle");
  assertEqual(s.swapTimer, 0, "swapTimer while not swapping");
  assertEqual(s.stepTimer, 0, "stepTimer while not resolving");

  // And the figures a played move leaves behind: the wave depth of the step
  // just resolved, and the three the level is measured by.
  assertEqual(s.lastWaves, 0, "lastWaves with no step resolved");
  assertEqual(s.moveScore, 0, "moveScore with no move running");
  assertEqual(s.bestMove, 0, "bestMove with no move scored");
  assertEqual(s.bestChain, 0, "bestChain with no chain run");

  // No refill is posed on any column: one empty string per column, whatever
  // the board.
  assertDeepEqual(
    s.refillKinds,
    RESTING_REFILL_KINDS,
    "refillKinds with no refill posed",
  );

  // The menu is live here, and rests on its first item.
  assertEqual(s.menuIndex, 0, "menuIndex on the title screen");
});
