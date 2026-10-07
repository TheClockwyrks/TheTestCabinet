// Wick — instrumentation/surface-present: the debug and automation surface is
// present, complete, versioned, and live.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`:
//   - "the game instance's `initialize` returns the finished surface. The
//     engine holds it and returns it from `engine.debug`, and it is reached
//     that way alone" — so `engine.debug` is the whole route, and the harness
//     reads it there and never builds one (`readDebugSurface`).
//   - "The surface carries `version` (`WICK_DEBUG_VERSION`, `1`), a plain
//     number, and the operations below" — the forty-three headings under "The
//     operations", listed as `REQUIRED_OPS` in `surface.ts`.
//   - "Each operation acts on the live game at the moment it is called. A pose
//     ... arranges the running game ... a reading ... returns plain data built
//     at the call" — so a pose changes what the next `snapshot()` reads.
//
// THE POSE. `setPlayerPosition(300, -120)` on an isolated run: "Sets the
// lamplighter's center to `(x, y)`", read back as `run.player.x` and
// `run.player.y`. Exact figures, since the pose stores what it was handed.
//
// WHY THIS ITEM IS BROAD. It is the seam every other point poses through; a
// build whose surface is missing or hollow fails those points too, and this
// is where the fault is named plainly, with the harness's own account of what
// is missing beside what the specification requires.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTypeOf } from "../assert";
import { WICK_DEBUG_VERSION } from "../constants";
import {
  REQUIRED_OPS,
  captureStill,
  createHarness,
  failSurface,
  isolate,
  type Harness,
} from "../harness";

/** The point the lamplighter is posed to, off the origin on both axes. */
const POSED_X = 300;
const POSED_Y = -120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries every operation, version 1, and poses the running game", async () => {
  // The harness's own account of a missing surface, paired with what the
  // specification requires, rather than a bare "Expected: null".
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);

  const surface = h.engine.debug as unknown as Record<string, unknown>;
  for (const op of REQUIRED_OPS) {
    assertTypeOf(surface[op], "function", `engine.debug.${op}`);
  }
  assertEqual(surface.version, WICK_DEBUG_VERSION, "engine.debug.version");

  // Live: a pose changes the running game and a reading reads it back.
  isolate(h);
  h.debug.setPlayerPosition(POSED_X, POSED_Y);
  const posed = h.snapshot();
  await h.frameDraw();
  captureStill(h, "surface");

  assertEqual(posed.version, WICK_DEBUG_VERSION, "snapshot().version");
  assertEqual(posed.screen, "playing", "screen after setScreen('playing')");
  assertEqual(posed.run.player.x, POSED_X, "player.x after setPlayerPosition");
  assertEqual(posed.run.player.y, POSED_Y, "player.y after setPlayerPosition");
});
