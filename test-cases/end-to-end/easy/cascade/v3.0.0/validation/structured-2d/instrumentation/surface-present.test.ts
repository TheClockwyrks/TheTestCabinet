// instrumentation/surface-present — the build returned its debug surface, the
// surface is whole, and it is really wired to the running game.
//
// THE RULE. specs/instrumentation.md makes the surface a deliverable: the game
// instance's `initialize` returns it, the engine holds that same object and
// hands it back from `engine.debug`, and it is reached that way alone. The file
// fixes `version` as `CASCADE_DEBUG_VERSION` (`1`), names every operation the
// surface carries, and states what an operation MEANS — a pose arranges the
// running game, and the game's own rules run from there exactly as they do in
// play.
//
// THREE READINGS, IN THE ORDER A FAULT WOULD SHOW.
//
//   1. The surface is there at all. `engine.debug` holds whatever the build's
//      instance returned; nothing here can stand in for it, because the build's
//      own module for the surface is never imported.
//   2. It is complete. `version` is the number the specification fixes, and
//      every operation `surface.ts` lists — the case's specification written
//      down as types — is a function on it. `setAutoStep` and `advance` are
//      deliberately NOT demanded: the engine owns the clock under this engine
//      and those two belong to the engineless build alone, so requiring them
//      here would fail a perfectly conformant build.
//   3. It is LIVE. A surface whose operations exist and arrange nothing is
//      present and useless. So a card is posed and read back off the snapshot,
//      and a move is posed and applied by the game's own rules.
//
// THE LIVE READING USES THE PLAINEST LEGAL MOVE THERE IS: a black eight onto a
// red nine, one column onto another (specs/tableau.md). Every other item in
// this suite drives the surface to pose its own scenario, so a surface that is
// missing or inert also shows up as those items failing; this one names the
// fault outright.
//
// WHAT IT DOES NOT DECIDE. Which rule accepted the move — that is
// `tableau.build-down-alternating` — nor that every pose is reported, which is
// `instrumentation/screen-reads-back`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDoesNotThrow, assertEqual, assertNotNull } from "../assert";
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

it("returns its debug surface from initialize", () => {
  // `engine.debug` holds whatever the build's instance returned, so reading it
  // IS the check: there is no page property to look for under this engine.
  assertDoesNotThrow(() => h.engine.debug);
  assertNotNull(h.engine.debug, "the surface engine.debug hands back");
  assertEqual(
    typeof h.engine.debug,
    "object",
    "the surface engine.debug hands back",
  );

  // The engine hands back the value the instance returned, unchanged and
  // unwrapped, so every read is the same object — the one every check in this
  // suite poses the game through.
  assertEqual(
    h.engine.debug,
    h.engine.debug,
    "two reads of engine.debug are the same object",
  );
});

it("carries every specified operation, as functions", async () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  openTable(h);
  await h.advance(1);
  // Before the assertions, so a missing operation still leaves the picture of
  // the table the surface was read off.
  captureStill(h, "surface");

  for (const operation of REQUIRED_OPS) {
    assertEqual(
      typeof api[operation],
      "function",
      `the ${operation} operation specs/instrumentation.md names`,
    );
  }
});
