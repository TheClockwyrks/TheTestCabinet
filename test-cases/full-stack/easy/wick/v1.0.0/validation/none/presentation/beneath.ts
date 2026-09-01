// presentation/beneath — where a frame put the world, for the three points about
// a screen drawn over a world that is not ticking.
//
// THE REQUIREMENT THEY SHARE. `specs/ui.md` — "levelup": "An overlay over the
// world, which stays drawn beneath it exactly as the tick that opened the overlay
// left it"; "chest": "An overlay over the held world"; "paused": "The world held
// still, with the HUD, under `PAUSED_TEXT`." And, under "What advances on each
// screen": on `levelup`, `chest` and `paused`, "Nothing. The world beneath holds
// exactly the tick it was at."
//
// WHAT IS READ. Where the frame drew the lamplighter and each enemy, taken from
// the produced files each is drawn from. The reading is taken twice — once on the
// last `playing` frame and once on the screen drawn over it — and the two are held
// against each other and against the world position the snapshot reports, so a
// build that stopped drawing the world, moved it, or redrew it from somewhere else
// fails whichever way it went wrong.
//
// WHY THE LAMPLIGHTER IS READ FROM ALL SEVEN OF ITS FILES. `specs/assets.md` has
// the lamplighter draw its idle sprite or one of six walk frames, and which one it
// is on a held screen is the animation point's business, not this one's; what
// matters here is that the figure is on the frame and in its place.

import { BLIT_TOL, type EnemyId } from "../constants";
import { assertEqual, assertNear } from "../assert";
import {
  stagePoint,
  type Harness,
  type WickSnapshot,
  type XY,
} from "../harness";
import { drawFromAt, enemySheet, oneDrawOf } from "./readouts";
import { primeSources } from "./sources";
import { LAMPLIGHTER_FILES } from "./walk";

/** Where one frame put the figure and the enemies, in stage units. */
export interface Placement {
  lamplighter: XY;
  enemies: Array<{ id: number; type: EnemyId; at: XY }>;
}

/** Decode every file a placement is read from, once per page. */
export async function primePlacement(
  h: Harness,
  types: readonly EnemyId[],
): Promise<void> {
  await primeSources(h, [
    ...LAMPLIGHTER_FILES,
    ...types.flatMap((type) => enemySheet(type)),
  ]);
}

/**
 * Where the last closed frame drew the lamplighter and each of `types`, each read
 * at the world position `snapshot` reports for it.
 *
 * Fails the point when one of them is not drawn there at all, which is what a
 * frame that dropped the world beneath its overlay looks like.
 */
export async function placementOf(
  h: Harness,
  snapshot: WickSnapshot,
  types: ReadonlyMap<number, EnemyId>,
  where: string,
): Promise<Placement> {
  const calls = await h.lastCalls();
  const figure = await oneDrawOf(
    h,
    calls,
    LAMPLIGHTER_FILES,
    `the produced lamplighter sprite on ${where}`,
  );
  const enemies: Placement["enemies"] = [];
  for (const enemy of snapshot.run.enemies ?? []) {
    const type = types.get(enemy.id);
    if (type === undefined) continue;
    const found = await drawFromAt(
      h,
      calls,
      enemySheet(type),
      stagePoint(snapshot, enemy.x, enemy.y),
      `a frame of ${type}'s produced sheet on ${where}, at the world position ` +
        "the held tick left it",
    );
    enemies.push({
      id: enemy.id,
      type,
      at: { x: found.draw.cx, y: found.draw.cy },
    });
  }
  return {
    lamplighter: { x: figure.draw.cx, y: figure.draw.cy },
    enemies,
  };
}

/** Both placements put the world in the same place, within `BLIT_TOL`. */
export function assertSamePlacement(
  before: Placement,
  after: Placement,
  where: string,
): void {
  assertNear(
    after.lamplighter.x,
    before.lamplighter.x,
    BLIT_TOL,
    `the stage x the lamplighter is drawn at on ${where}, which is where the ` +
      "last playing frame drew it (specs/ui.md)",
  );
  assertNear(
    after.lamplighter.y,
    before.lamplighter.y,
    BLIT_TOL,
    `the stage y the lamplighter is drawn at on ${where}, which is where the ` +
      "last playing frame drew it (specs/ui.md)",
  );
  assertEqual(
    after.enemies.length,
    before.enemies.length,
    `the enemies drawn on ${where}, which is every one the last playing frame ` +
      "drew (specs/ui.md)",
  );
  for (const [index, enemy] of after.enemies.entries()) {
    const was = before.enemies[index]!;
    assertNear(
      enemy.at.x,
      was.at.x,
      BLIT_TOL,
      `the stage x the ${enemy.type} is drawn at on ${where}, which is where ` +
        "the last playing frame drew it (specs/ui.md)",
    );
    assertNear(
      enemy.at.y,
      was.at.y,
      BLIT_TOL,
      `the stage y the ${enemy.type} is drawn at on ${where}, which is where ` +
        "the last playing frame drew it (specs/ui.md)",
    );
  }
}
