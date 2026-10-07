// instrumentation/surface-reached-only-the-documented-way — the surface is where
// the specification says it is, from the moment the game has initialized.
//
// specs/instrumentation.md, the `simple-3d` branch: "the build's `initialize`
// returns the finished surface beside the state it built, as the pair
// `[state, debug]`. The engine returns that same value from `engine.debug`, and
// it is reached that way alone: nothing is installed on the page."
//
// THIS ENGINE'S VERSION OF THE POINT. The same sentence reads the other way for
// an engineless build — one documented global, `window.__gantry` — and the two
// halves swap here: the surface must come back off `engine.debug`, and nothing
// must be installed on the host for it to be reached by instead.
//
// THREE READINGS, AND THE LAST TWO ARE THE ONES WITH TEETH. That `engine.debug`
// carries the surface is read off the engine. That it was carrying it "as soon
// as the game has initialized" is read off the opening snapshot: the harness
// takes one through `engine.debug` the moment `initialize` resolves and BEFORE it
// resets the game or advances a single frame, so a build that returned its
// surface later, or filled it in on its first frame, would have had nothing to
// answer with. And that it is reached "that way alone" is read off the host: a
// build that also parked a handle on the global object would be offering a second
// door the specification does not give it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, fail } from "../assert";
import { createHarness, type Harness } from "../harness";

/**
 * The global an ENGINELESS build installs its surface on, which an engine build
 * must not install anything on.
 *
 * Named here rather than imported: this engine's harness has no such constant,
 * because under this engine the specification gives the surface no home on the
 * host at all.
 */
const ENGINELESS_HANDLE = "__gantry";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the surface from engine.debug as soon as the game has initialized", async () => {
  const held = h.engine.debug as unknown;
  await h.advance(1);
  await h.capture(
    "surface-handle",
    "The build carrying its surface where the engine hands it back",
  );

  assertEqual(
    held === null ? "null" : typeof held,
    "object",
    "the type of engine.debug",
  );
  assertEqual(
    typeof (held as Record<string, unknown>)["snapshot"],
    "function",
    "engine.debug.snapshot, so what the engine handed back is the surface",
  );

  // Read through that surface before this harness reset the game or drove a
  // frame: it answered from the moment `initialize` resolved.
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

  // "It is reached that way alone: nothing is installed on the page."
  const parked = (globalThis as unknown as Record<string, unknown>)[
    ENGINELESS_HANDLE
  ];
  if (parked !== undefined) {
    fail(
      "nothing installed on the host to reach the surface by, since the " +
        "engine hands it back from engine.debug and it is reached that way " +
        "alone (specs/instrumentation.md)",
      `globalThis.${ENGINELESS_HANDLE} is a ${typeof parked}`,
    );
  }
});
