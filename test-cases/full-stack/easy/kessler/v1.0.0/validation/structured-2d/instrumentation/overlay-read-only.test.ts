// instrumentation/overlay-read-only — a session watched through the overlay
// ends exactly where the same session unwatched ends.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md (Diagnostics): "keep
// every source a pure read, so watching the overlay leaves the game as it is",
// backed by the deterministic core: "given the same seed and the same sequence
// of operations and elapsed ticks, the game reproduces identical snapshots
// every time".
//
// THE READ IS THE DETERMINISM ITSELF. Two sessions pose the same seeded, busy
// scene — a ball in flight, targets it can reach, a falling pod, a running
// pierce timer, the shield — and run the same ticks. One shows the overlay over
// the middle stretch and hides it again; the other presses an unbound key at
// the same moments, so both feel the same key edges and the same tick count.
// If every diagnostic source is a pure read, the final snapshots are identical
// to the float; any divergence is the overlay writing into the game.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  advanceTicks,
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  spawnPodPolar,
  tap,
  type Harness,
  type KesslerSnapshot,
} from "../harness";
import { OVERLAY_TOGGLE_CODE } from "./overlay";

/** A key edge no binding of specs/controls.md carries. */
const NEUTRAL_CODE = "KeyX";

/** The session seed and the stretch the overlay watches. */
const SEED = 5;
const LEAD_TICKS = 30;
const WATCH_TICKS = 60;
const TAIL_TICKS = 30;

/**
 * One session: the busy seeded scene, the lead, a key edge, the watched
 * stretch, the same key edge again, and the tail. `code` is the only
 * difference between the two runs.
 */
async function runSession(
  h: Harness,
  code: string,
  watched: (h: Harness) => Promise<unknown>,
): Promise<KesslerSnapshot> {
  isolate(h, SEED);
  h.debug.spawnTarget(1, 2, 1);
  h.debug.spawnTarget(2, 5, 2);
  spawnBallPolar(h, 250, 180, 212, 212);
  spawnPodPolar(h, "widen", 420, 300);
  h.debug.setEffectTicks("pierce", 200);
  h.debug.setShield(true);

  await advanceTicks(h, LEAD_TICKS);
  await tap(h, code);
  await watched(h);
  await tap(h, code);
  await advanceTicks(h, TAIL_TICKS);
  return h.snapshot();
}

let a: Harness;
let b: Harness;

beforeEach(async () => {
  a = await openHarness();
  b = await openHarness();
});

afterEach(() => {
  a?.dispose();
  b?.dispose();
});

it("leaves the watched session identical to the unwatched one", async () => {
  const unwatched = await runSession(a, NEUTRAL_CODE, (h) =>
    advanceTicks(h, WATCH_TICKS),
  );
  const watched = await runSession(b, OVERLAY_TOGGLE_CODE, (h) =>
    captureReplay(h, "watched", () => advanceTicks(h, WATCH_TICKS)),
  );
  assertDeepEqual(
    watched,
    unwatched,
    "the watched session's final snapshot against the unwatched one",
  );
});
