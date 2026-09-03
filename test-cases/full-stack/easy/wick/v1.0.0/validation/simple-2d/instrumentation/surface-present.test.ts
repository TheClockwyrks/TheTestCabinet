// instrumentation/surface-present — the build returned its debug and
// automation surface beside its state, that surface carries every operation
// the specification names as a function and `version` 1, and it is live: a
// pose changes the running game and `snapshot` reads the change back.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md: "the build's
// `initialize` returns the finished surface beside the state it built, as the
// pair `[state, debug]`. The engine returns that same value from
// `engine.debug`, and it is reached that way alone"; "The surface carries
// `version` (`WICK_DEBUG_VERSION`, `1`), a plain number, and the operations
// below", the forty-three headings under "The operations", transcribed as
// REQUIRED_OPS; and "A pose takes the current state ... and returns the next
// `WickState`" while "a reading ... returns what it read".
//
// WHY IT IS THE BROADEST POINT HERE. Every other point in this directory poses
// its scenario through the same surface, so a build that hollowed it out fails
// those too; this is where the fault is named plainly. `surfaceFault` is what
// the harness found when it read `engine.debug`, and naming it is the point's
// whole first half. The second half is one pose and one read: `setHp(40)` on
// a fresh run, then the snapshot reporting 40 and the engine's own state
// carrying it, so a surface whose operations return the state they were
// handed fails here rather than silently posing nothing everywhere else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WICK_DEBUG_VERSION } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  REQUIRED_OPS,
  type Harness,
} from "../harness";

/** A health figure no fresh run holds, so the read-back is of the pose. */
const POSED_HP = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("is returned beside the state, carries every operation, and is live", async () => {
  // The harness's own account of what is missing, paired with what the
  // specification requires, rather than a bare "Expected: null".
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);

  const raw = h.engine.debug as unknown as Record<string, unknown>;
  assertEqual(raw.version, WICK_DEBUG_VERSION, "engine.debug.version");
  for (const op of REQUIRED_OPS) {
    assertEqual(typeof raw[op], "function", `engine.debug.${op}`);
  }

  h.reset();
  h.debug.setScreen("playing");
  h.debug.setHp(POSED_HP);
  const read = h.snapshot();
  await h.tick(1);
  captureStill(h, "surface");

  assertEqual(read.screen, "playing", "the screen setScreen entered");
  assertEqual(read.run.player.hp, POSED_HP, "player.hp read back off the pose");
  assertEqual(
    h.state.run.player.hp,
    POSED_HP,
    "the engine's own state after the pose ran through apply",
  );
});
