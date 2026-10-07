// presentation/enemies-drawn-from-sheets — each of the thirteen enemies is drawn
// from its own produced sheet, at its own place.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The sprites" gives every
// enemy a sheet of its own: "Each common enemy, a walk cycle |
// `assets/sprites/enemies/<id>/0.png` to `3.png`, for each of the ten common ids
// in `ENEMY_IDS`", with `mothwing`, `owl` and `dark` on rows of their own at the
// same paths. `specs/ui.md` — "playing" puts each on the field: the screen shows
// "every enemy, projectile, zone, gem, and pickup inside the view drawn at its
// world position", and `specs/assets.md` has each sprite "drawn centered on the
// thing it depicts".
//
// WHY ALL THIRTEEN AT ONCE. The requirement is that each type reaches the canvas
// as ITS OWN sheet, so the frame that decides it has to carry every type
// together: a build that drew one sheet for every enemy, or that mapped the
// roster onto the sheets one place out, passes any reading taken over a single
// type and fails this one. `specs/overview.md` names the same thing among what a
// player reads at a glance: "Each of the thirteen enemy types has its own
// silhouette".
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, and
// the thirteen posed on a grid of `240` by `240` units about the lamplighter,
// skipping the slot it stands on. Every slot is inside the view (`x` to `±480`,
// `y` to `±240`, against a view reaching `±640` and `±360`) with room for the
// Dark's `80 x 80` sprite, and no two are closer than the largest pair of radii,
// so each draw is unambiguously one enemy's. `enemyMotion` and `enemyContact`
// stay off, so nothing walks out of its slot and nothing touches the lamplighter.
//
// WHAT IS READ. For each posed enemy, the image drawn at its own place, and which
// produced file that image is, decided by the file's own pixels. A build whose
// sheet for one type is another type's fails at that type alone.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit on the centre, which is one device
// pixel at the harness's fit: a build is free to round a fractional world
// position to the pixel grid. The identity of the file has no tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { ENEMY_IDS, type EnemyId } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  stagePoint,
  type Harness,
} from "../harness";
import { drawFromAt, enemySheet } from "./readouts";
import { primeSources } from "./sources";

/** The grid the roster is posed on, the lamplighter's own slot left out. */
const SLOTS: ReadonlyArray<{ dx: number; dy: number }> = [-240, 0, 240].flatMap(
  (dy) =>
    [-480, -240, 0, 240, 480]
      .filter((dx) => dx !== 0 || dy !== 0)
      .map((dx) => ({ dx, dy })),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every one of the thirteen enemies from its own produced sheet", async () => {
  const posed = await isolate(h);
  const sheets = new Map<EnemyId, string[]>(
    ENEMY_IDS.map((id) => [id, enemySheet(id)]),
  );
  await primeSources(h, [...sheets.values()].flat());

  const at = posed.run.player;
  const placed: Array<{ type: EnemyId; id: number }> = [];
  for (const [index, type] of ENEMY_IDS.entries()) {
    const slot = SLOTS[index]!;
    const spawned = await placeEnemy(h, type, at.x + slot.dx, at.y + slot.dy);
    placed.push({ type, id: spawned.id });
  }

  const snapshot = await h.step(1);
  const calls = await h.lastCalls();
  await captureStill(h, "roster");

  assertEqual(
    snapshot.run.enemies.length,
    ENEMY_IDS.length,
    "the enemies on the field, which is one of each of the thirteen types " +
      "(specs/enemies.md)",
  );
  for (const { type, id } of placed) {
    const enemy = mustEnemy(snapshot, id);
    await drawFromAt(
      h,
      calls,
      sheets.get(type) as string[],
      stagePoint(snapshot, enemy.x, enemy.y),
      `a frame of ${type}'s own produced sheet ` +
        `(assets/sprites/enemies/${type}/)`,
    );
  }
});
