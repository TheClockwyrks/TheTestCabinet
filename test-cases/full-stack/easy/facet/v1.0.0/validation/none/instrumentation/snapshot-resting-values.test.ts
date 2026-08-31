// Facet — instrumentation/snapshot-resting-values: with no board in play the
// snapshot still reports every field, holding its resting value.
//
// WHY THIS IS A POINT OF ITS OWN. specs/instrumentation.md fixes the snapshot's
// shape and then adds the sentence this point is about: "The shape is fixed, and
// every field is present on every screen. A field with nothing to report holds
// its resting value rather than going missing: `board` is
// `{ cols: 0, rows: 0, cells: [] }` while no board is in play, `selection` and
// `refusal` are `null` while none stands, `chainStep` and `stepTimer` are `0`
// while `phase` is `idle`, and `menuIndex` is live on every screen carrying a
// menu and rests at `0`." A build that builds its snapshot out of the board it
// is holding, and reports nothing when it holds none, satisfies every point that
// reads a snapshot on the `playing` screen and breaks every reader that looks at
// one anywhere else — a `board` that is `undefined` rather than empty, a
// `selection` that is simply absent. The absences are exactly what a shape
// checked only where the game is busiest never sees.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE. That `reset` puts the game here is
// `instrumentation/reset-restores`; what the title screen SHOWS is the
// `screens` points. The screen is read as the precondition — no board is in play
// — and everything asserted after it is the resting reading itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
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

afterEach(async () => {
  await h?.dispose();
});

it("holds every field at its resting value while no board is in play", async () => {
  requireSurface();
  // The title screen, where the game stands before a round has begun: nothing is
  // selected, nothing is refused, no chain is running, and there is no board.
  await captureStill(h, "title");

  const s = await h.snapshot();
  assertEqual(s.screen, "title", "the screen the resting snapshot is read on");

  // The board, stated exactly as the specification states it. Read field by
  // field rather than as one object, so a build that carries an extra reading
  // of its own beside the three is not failed for it.
  assertEqual(s.board.cols, 0, "board.cols with no board in play");
  assertEqual(s.board.rows, 0, "board.rows with no board in play");
  assertDeepEqual(s.board.cells, [], "board.cells with no board in play");

  // `null` rather than missing: `assertNull` refuses `undefined` too, which is
  // the shape a build that omitted the field would report.
  assertNull(s.selection, "selection with none standing");
  assertNull(s.refusal, "refusal with none standing");

  // Resolution is not running, and the two fields that only mean something
  // while it is are `0` rather than left at whatever a previous chain left.
  assertEqual(s.phase, "idle", "phase with no board in play");
  assertEqual(s.chainStep, 0, "chainStep while idle");
  assertEqual(s.stepTimer, 0, "stepTimer while idle");

  // The menu is live here, and rests on its first item.
  assertEqual(s.menuIndex, 0, "menuIndex on the title screen");
});
