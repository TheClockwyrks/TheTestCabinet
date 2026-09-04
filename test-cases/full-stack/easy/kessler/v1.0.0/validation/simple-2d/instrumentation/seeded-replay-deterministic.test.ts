// instrumentation/seeded-replay-deterministic — the same seed, the same
// operations, and the same elapsed ticks reproduce identical snapshots,
// including the same pods of the same kinds in the same order.
//
// specs/instrumentation.md, "A deterministic core": "Given the same seed and
// the same sequence of operations and elapsed ticks, the game reproduces
// identical snapshots every time", resting on "Seeded randomness. The game
// holds one pseudo-random generator, seeded by `reset` and consumed only by
// the pod draws `specs/pods.md` states". specs/pods.md fixes that generator:
// "a mulberry32 generator seeded with the session's seed", drawing `u1` per
// destruction and shedding at `u1 < 0.25`.
//
// THE SCENARIO CONSUMES THE STREAM. Determinism over a session that never
// draws is vacuous, so each session destroys eight ring-1 targets, one at a
// time — a posed target, a posed ball crossing its face, the destruction
// resolving through the game's own tick — with `waveAdvance` held off so the
// emptied field never fires a clearing, and `podSpawn` ON so every destruction
// consumes the seeded stream. Seed 3's mulberry32 stream sheds on four of
// those eight draws (a figure of the spec's own generator, not of any build),
// so the two final snapshots compared below each hold falling pods.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureReplay,
  isolate,
  openHarness,
  type Harness,
  type KesslerSnapshot,
} from "../harness";
import { polarPose, slotCenter } from "./helpers";

/** The seed both sessions are laid with. */
const SEED = 3;
/** The ring-1 slots destroyed, in order — all with arc centers far from the
 * deflector at 90, so no shed pod is caught inside the scenario. */
const SLOTS = [4, 5, 6, 7, 8, 9, 10, 11];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/** One seeded session: the same operations, the same elapsed ticks. */
async function driveSeeded(on: Harness): Promise<KesslerSnapshot> {
  isolate(on, SEED);
  on.debug.setPodSpawn(true);
  for (const slot of SLOTS) {
    on.debug.spawnTarget(1, slot, 1);
    const ball = polarPose(270, slotCenter(1, slot), 240, 0);
    on.debug.spawnBall(ball.x, ball.y, ball.vx, ball.vy);
    await on.until((s) => s.rings[0].targets.length === 0, { maxTicks: 12 });
    on.debug.clearBalls();
  }
  return on.tick(4);
}

it("replays a seeded session to identical snapshots", async () => {
  const first = await captureReplay(h, "seeded", () => driveSeeded(h));

  const second = await openHarness();
  let replayed: KesslerSnapshot;
  try {
    replayed = await driveSeeded(second);
  } finally {
    second.dispose();
  }

  // The seeded stream shed pods, so the equality below says something about
  // the draws, not just about an empty field.
  assertGreaterThanOrEqual(
    first.pods.length,
    1,
    "pods shed by seed 3's mulberry32 stream (specs/pods.md)",
  );
  assertDeepEqual(
    first.pods,
    replayed.pods,
    "the same pods of the same kinds in the same order",
  );
  assertDeepEqual(first, replayed, "the two sessions' snapshots, identical");
});
