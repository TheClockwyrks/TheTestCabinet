// instrumentation/surface-reached-only-the-documented-way — the surface is where
// the specification says it is, from the moment the game has initialized.
//
// specs/instrumentation.md § The operations, the engine branch: the surface is
// the value the game instance's `initialize` returns — "The engine holds it and
// returns it from `engine.debug`, and it is reached that way alone: nothing is
// installed on the page." That is the whole contract on this build: one place the
// surface is reached, and it is there before anything drives the game.
//
// THREE READINGS, AND THE LAST TWO ARE THE ONES WITH TEETH.
//
//   `engine.debug` carries the surface, which is the documented way.
//
//   NOTHING IS INSTALLED ANYWHERE ELSE. The engineless contract puts the surface
//   on `window.__gantry`, and the sentence above says an engine build does not:
//   so the handle that build would use is read on the host object and must be
//   absent. A build that installed its surface globally as well would be reached
//   two ways, and the second is not a way this specification allows.
//
//   AND IT ANSWERED "AS SOON AS THE GAME HAS INITIALIZED". That is read off the
//   opening snapshot: the harness takes one through the surface the moment
//   `engine.initialize` resolves and BEFORE it resets the game or advances a
//   single frame, so a build that finished its surface on its first frame, or
//   after its first input, would have had nothing to answer with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { createHarness, type Harness } from "../harness";

/** The handle the ENGINELESS contract puts the surface on, and this one does not. */
const ENGINELESS_HANDLE = "__gantry";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the surface from engine.debug and installs it nowhere else", async () => {
  const held: unknown = h.engine.debug;
  assertEqual(
    held === null ? "null" : typeof held,
    "object",
    "the type of engine.debug",
  );
  assertEqual(
    typeof (held as Record<string, unknown>).snapshot,
    "function",
    "engine.debug.snapshot, so what the engine holds is the surface",
  );
  assertTrue(
    held === h.surface,
    "engine.debug to hand back the very object the game instance's " +
      "initialize returned, rather than a copy of it " +
      "(specs/instrumentation.md)",
  );

  assertEqual(
    (globalThis as unknown as Record<string, unknown>)[ENGINELESS_HANDLE],
    undefined,
    `window.${ENGINELESS_HANDLE}, which an engine build leaves alone: the ` +
      'surface is reached off `engine.debug` "that way alone: nothing is ' +
      'installed on the page" (specs/instrumentation.md)',
  );

  // Read through that surface before this harness reset the game or drove a
  // frame: it answered from the moment the game had initialized.
  assertNotNull(
    h.openingSnapshot,
    "the reading taken through engine.debug before anything was driven " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    typeof h.openingSnapshot?.screen,
    "string",
    "the screen that opening reading reported, so it was a real snapshot",
  );

  await h.advance(1);
  await h.capture(
    "surface-handle",
    "The build carrying its surface where the specification puts it",
  );
});
