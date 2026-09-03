// director/despawn-beyond-distance — a common that wandered off is removed.
//
// THE SPEC LINE. `specs/enemies.md`, "Despawning": "Each tick `despawning` is
// on, every common enemy whose center is farther than `DESPAWN_DISTANCE`
// (`1200`) units from the lamplighter's center is removed: no gem, no kill, no
// cue, and every re-hit entry naming it dropped." `specs/world.md` ("One
// tick") runs despawning at phase 10, "despawning while `despawning` is on",
// so one tick is all it takes.
//
// WHERE THE MOTH STANDS. 1201 units out along `+x` from the lamplighter, one
// unit past the boundary, so the removal is decided by the rule and not by a
// margin. A moth is rank `common` (the roster), which is the rank the rule
// names. Its removal is read as an absence in the next snapshot, and the three
// things a removal is NOT are read beside it: `kills` unchanged from the 0 a
// fresh run holds, no gem on the field where a common's death would leave one
// (`specs/enemies.md`, "Drops": a moth's death drops a `small` gem), and no
// `kill` cue on the bus, which `specs/ui.md` plays when "An enemy dies".
//
// THE DRIVE. The isolated world with `despawning` alone on and one tick.
// `enemyMotion` stays off, so the moth is exactly where it was posed when the
// distance is tested, and nothing else in the night can account for its going.
//
// THE TOLERANCE. None: the enemy is in the snapshot or it is not, and the
// counts beside it are whole.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import { CUES, DESPAWN_DISTANCE } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  cuesNamed,
  enable,
  enemyById,
  isolate,
  onCue,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** One unit past the boundary the rule names. */
const BEYOND = DESPAWN_DISTANCE + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes a moth 1201 units out on the next tick, with no gem, no kill, and no cue", async () => {
  isolate(h);
  const moth = placeEnemyNear(h, "moth", BEYOND, 0);
  enable(h, "despawning");
  const heard = onCue(h);

  const after = await advanceTicks(h, 1);
  captureStill(h, "removed");

  assertUndefined(
    enemyById(after, moth),
    `the moth posed ${BEYOND} units out, after one tick with despawning on`,
  );
  assertLength(after.run.gems, 0, "the gems on the field after the removal");
  assertEqual(after.run.kills, 0, "the kill count after the removal");
  assertLength(
    cuesNamed(heard, CUES.kill),
    0,
    "the kill cues that sounded during the removal",
  );
});
