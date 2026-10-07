// Wick — instrumentation/surface-present: the build installed the debug and
// automation surface on `window.__wick`, it carries every operation the
// specification names as a function, `version` reads `1`, and the surface is
// live: a pose changes the running game and `snapshot()` reads the change back.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md, and that file alone):
//
//   "the build installs the finished surface on `window.__wick` as soon as the
//    game has initialized"                                      — the global
//   "The surface carries `version` (`WICK_DEBUG_VERSION`, `1`), a plain number,
//    and the operations below"                                  — REQUIRED_OPS
//   "Each operation is a read of the game's state or a pose of one part of it. A
//    pose sets one thing"                                       — the surface is live
//   `setHp(hp)`: "Sets `hp` to `hp`, a real number at most `maxHp`"
//
// WHY THE WORLD IS POSED AS IT IS. Under an engine the surface is handed back to
// a host that holds it; nothing holds it here, and an engineless run seeds no
// source at all, so the global, every operation on it, and the version are all
// deliverables of the build. Every other point in this directory poses its
// scenario through the same surface, so a build that hollowed it out fails those
// points too; this one is where the fault is named plainly. The liveness read is
// the plainest pose the surface has: one field, set and read back on an
// isolated run, before any tick could have changed it.
//
// WHAT THIS FILE DOES NOT ASSERT. What each operation DOES is its own point next
// door; here each is only present as a function.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  BASE_MAX_HP,
  HANDLE,
  REQUIRED_OPS,
  WICK_DEBUG_VERSION,
} from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  isolate,
  player,
  surfaceVersion,
  type Harness,
} from "../harness";

/** A health figure that is not the fresh run's, so the read-back is of the pose. */
const POSED_HP = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`installs a live window.${HANDLE} carrying version 1 and every operation`, async () => {
  // The harness's own account of what is missing, paired with what the
  // specification requires, rather than an "Expected: null" over the reason.
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);

  const probed = await h.probe(REQUIRED_OPS);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `window.${HANDLE}.${op}`);
  }
  assertEqual(
    await surfaceVersion(h),
    WICK_DEBUG_VERSION,
    `window.${HANDLE}.version`,
  );

  // Live: a pose changes the running game and the snapshot reads it back.
  const posed = await isolate(h);
  assertEqual(player(posed).hp, BASE_MAX_HP, "hp before the pose");
  await h.debug.setHp(POSED_HP);
  const read = await h.snapshot();
  await captureStill(h, "surface");
  assertEqual(player(read).hp, POSED_HP, "hp read back after setHp");
});
