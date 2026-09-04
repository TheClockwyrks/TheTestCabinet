// instrumentation/overlay-read-only — a run watched through the overlay over
// 120 ticks ends exactly where the same run unwatched ends.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md (Diagnostics): "keep
// every source a pure read, so watching the overlay leaves the game as it
// is", backed by "A deterministic core": "Given the same seed, the same
// sequence of operations, and the same number of ticks, the game reaches the
// same `run` and `rngState` every time".
//
// THE READ IS THE DETERMINISM ITSELF. Two engines pose the same seeded, busy
// night with the director, motion, contact, fire, and effects all on, and run
// the same ticks. One shows the overlay over the middle stretch and hides it
// again; the other presses an unbound key at the same moments, so both feel
// the same key edges and the same frame count. If every diagnostic source is
// a pure read the final snapshots are identical to the float; any divergence
// is the overlay writing into the game.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { OVERLAY_TOGGLE_CODE, UNBOUND_KEY } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  spawnEnemyAt,
  tap,
  type Harness,
  type WickSnapshot,
} from "../harness";

const SEED = 5;
const LEAD_TICKS = 30;
const WATCH_TICKS = 120;
const TAIL_TICKS = 30;

/**
 * One session: the busy seeded night, the lead, a key edge, the watched
 * stretch, the same key edge again, and the tail. `code` is the only
 * difference between the two runs.
 */
async function runSession(
  h: Harness,
  code: string,
  watched: (on: Harness) => Promise<void>,
): Promise<WickSnapshot> {
  isolate(h, { seed: SEED, keepTaper: true });
  holdWeapon(h, "halo", 1);
  holdWeapon(h, "pin", 2);
  spawnEnemyAt(h, "moth", 300, 0);
  spawnEnemyAt(h, "bat", -300, 100);
  spawnEnemyAt(h, "wisp", 0, 300);
  enable(
    h,
    "spawning",
    "enemyMotion",
    "enemyContact",
    "weaponFire",
    "effectMotion",
  );

  await h.tick(LEAD_TICKS);
  await tap(h, code);
  await watched(h);
  await tap(h, code);
  await h.tick(TAIL_TICKS);
  return h.snapshot();
}

let a: Harness;
let b: Harness;

beforeEach(async () => {
  a = await createHarness();
  b = await createHarness();
});

afterEach(() => {
  a?.dispose();
  b?.dispose();
});

it("leaves the watched session identical to the unwatched one", async () => {
  const unwatched = await runSession(a, UNBOUND_KEY, (on) =>
    on.advance(WATCH_TICKS),
  );
  const watched = await runSession(b, OVERLAY_TOGGLE_CODE, (on) =>
    captureReplay(on, "watched", () => on.advance(WATCH_TICKS)),
  );
  assertDeepEqual(
    watched,
    unwatched,
    "the watched session's final snapshot against the unwatched one",
  );
});
