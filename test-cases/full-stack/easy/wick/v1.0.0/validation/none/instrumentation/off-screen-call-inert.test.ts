// Wick — instrumentation/off-screen-call-inert: `setHp(10)`,
// `spawnEnemy("moth", 0, 0)`, `setTick(100)`, and `setWeapon(0, "pin", 1)`
// issued on `title`, and `setPlayerPosition(5, 5)` issued on `levelup`, each
// leave the state exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The
// operations"): "A call on a screen the operation does not apply to leaves the
// state exactly as it was, and each operation names the screens it applies
// to. 'A run screen' below means `playing` or `paused`." `setHp`, `setTick`,
// `setWeapon`, and `setPlayerPosition` each apply "on a run screen";
// `spawnEnemy` "on `playing` and `paused`". The comparison across each call is
// exact equality of the state a pose governs.
//
// WHY THE WORLD IS POSED AS IT IS. The title is the screen a reset leaves and
// one no run-screen operation applies on; the level-up overlay is reached by
// the real path, so the call on it is made over an open overlay whose run a
// build might reach through anyway.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  posedState,
  type Harness,
  type WickSnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Make `call`, and read the state untouched across it. */
async function requireInert(
  before: WickSnapshot,
  name: string,
  call: () => Promise<void>,
): Promise<void> {
  try {
    await call();
  } catch {
    // A refusal leaves the state as it was too; what is read is the state.
  }
  assertDeepEqual(
    posedState(await h.snapshot()),
    posedState(before),
    `the state across ${name} on ${before.screen}`,
  );
}

it("leaves the state as it was when called off a run screen", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the calls are made on");
  await requireInert(title, "setHp(10)", () => h.debug.setHp(10));
  await requireInert(title, "spawnEnemy('moth', 0, 0)", () =>
    h.debug.spawnEnemy("moth", 0, 0),
  );
  await requireInert(title, "setTick(100)", () => h.debug.setTick(100));
  await requireInert(title, "setWeapon(0, 'pin', 1)", () =>
    h.debug.setWeapon(0, "pin", 1),
  );

  await isolate(h);
  const overlay = await openLevelUp(h);
  assertEqual(overlay.screen, "levelup", "the screen the last call is made on");
  await requireInert(overlay, "setPlayerPosition(5, 5)", () =>
    h.debug.setPlayerPosition(5, 5),
  );
  await captureStill(h, "inert");
});
