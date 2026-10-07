// Wick — enemies/weave-anchor-chases: a weaver's anchor advances one step
// toward the lamplighter on every tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Weave"): "A weaving enemy chases with an anchor and
//     is drawn beside it. The anchor is what advances toward the lamplighter",
//     and "The state carries the position and the heading, and the anchor is
//     the position minus the offset at the current age".
//   - `specs/enemies.md` ("Weave"), one tick of a weaver:
//     `anchor = position - perp(heading) * offset(age)`,
//     `heading = unit(lamplighter - anchor)`, then
//     `anchor = anchor + heading * speed * TICK_DT`.
//   - `specs/enemies.md` ("The roster"): a wisp's speed is `90`, so its step is
//     90 / 60 = 1.5 units ("Movement").
//   - `specs/enemies.md` ("Weave"): "At spawn the offset is `0`, so the anchor
//     is the spawn position", which is where the reading starts.
//
// WHAT IS READ. Sixty ticks. Before and after each one the anchor is recovered
// from the snapshot the same way the specification defines it, the wisp's center
// minus `perp(heading) × offset(age)`, and the anchor after the tick is the
// anchor before it plus 1.5 units along the unit vector from that anchor to the
// lamplighter's center. A build whose anchor drifts, holds still, or advances
// the position instead answers differently on every tick.
//
// WHY THE NIGHT IS POSED AS IT IS. One wisp and nothing else, `enemyMotion` the
// only switch on, and the lamplighter left standing at the origin so the target
// the anchor chases is fixed while the anchor moves. The wisp is posed 300 units
// along +x: the sixty steps close 90 of them, so the anchor never reaches the
// lamplighter and the tick under test is always the ordinary one rather than the
// coincident case, which is its own point.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on each component of the anchor, which is
// a position integrated tick by tick and recovered through a sine.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import { ENEMIES, MOTION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  unit,
  type Harness,
  type Point,
} from "../harness";
import { anchorOf } from "./roster";

/** The weaver this point reads: a wisp, behavior `weave`, speed 90. */
const TYPE = "wisp";

/** One step of the wisp's speed: 90 / 60 = 1.5 units. */
const STEP = ENEMIES[TYPE].speed * TICK_DT;

/** Where the wisp is posed, along +x of the lamplighter's center. */
const WISP_DX = 300;

/** How many ticks the anchor's chase is read across. */
const TICKS = 60;

/** One tick's anchors: the one it worked from, and the one it reached. */
interface Advance {
  from: Point;
  to: Point;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("advances the wisp's anchor 1.5 units toward the lamplighter each tick", async () => {
  isolate(h);
  enable(h, "enemyMotion");
  const wisp = spawnEnemyNear(h, TYPE, WISP_DX, 0);
  const posed = h.snapshot();
  const player = { x: posed.run.player.x, y: posed.run.player.y };
  const advances: Advance[] = [];

  await captureReplay(h, "anchor", async () => {
    let from = anchorOf(present(enemyById(posed, wisp), "the posed wisp"));
    for (let i = 0; i < TICKS; i += 1) {
      const after = await h.tick(1);
      const now = present(enemyById(after, wisp), `the wisp on tick ${i + 1}`);
      const to = anchorOf(now);
      advances.push({ from, to });
      from = to;
    }
  });

  for (const [i, advance] of advances.entries()) {
    const aim = unit(player.x - advance.from.x, player.y - advance.from.y);
    assertWithin(
      advance.to.x,
      advance.from.x + aim.x * STEP,
      MOTION_TOLERANCE,
      `tick ${i + 1}: x of the anchor after its step`,
    );
    assertWithin(
      advance.to.y,
      advance.from.y + aim.y * STEP,
      MOTION_TOLERANCE,
      `tick ${i + 1}: y of the anchor after its step`,
    );
  }
});
