// presentation/levelup-draws-world-beneath — the level-up overlay is drawn OVER
// the world, which stays exactly where the tick that opened it left it.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md` — "levelup": "An overlay over the
// world, which stays drawn beneath it exactly as the tick that opened the overlay
// left it." Under "What advances on each screen", `levelup` advances "Nothing. The
// world beneath holds exactly the tick it was at." `specs/overview.md` names the
// same thing among what a player reads at a glance: "The level-up overlay, the
// chest overlay, and the pause screen read over the frozen world beneath them,
// with that world visibly quieted."
//
// HOW THE OVERLAY IS OPENED. Through the queue the specification itself opens it
// from: `setPendingLevelUps(1)`, which `specs/instrumentation.md` says makes "A
// `playing` tick that ends with it above `0` open the overlay exactly as a gain
// does", and then one tick. No menu is pressed and no gem is collected on the way,
// because a build with a broken title and a working overlay must fail the title's
// points and pass this one.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, and
// two enemies of different types posed at different places, so the reading is over
// something that can be told apart and can be seen to move if it moves.
// `enemyMotion` and `enemyContact` stay off, so the world beneath is still for
// reasons of the check rather than reasons of the build — which is the point: what
// this reads is whether the FRAME still carries it, not whether the simulation
// stopped.
//
// WHAT IS READ. Where the frame drew the lamplighter and each enemy, on the last
// `playing` frame and then on the overlay frame and on sixty overlay frames after
// it: each must still be drawn, from its own produced file, at the world position
// the held tick left it.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit, which is one device pixel at the
// harness's fit: a build is free to round a fractional world position to the pixel
// grid before it blits. A world the overlay dropped, or redrew somewhere else,
// misses by everything.

import { afterEach, beforeEach, it } from "vitest";
import { type EnemyId } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { assertSamePlacement, placementOf, primePlacement } from "./beneath";

/** Two enemies of different types, at different places inside the view. */
const POSED: ReadonlyArray<{ type: EnemyId; dx: number; dy: number }> = [
  { type: "moth", dx: 260, dy: -140 },
  { type: "beetle", dx: -300, dy: 170 },
];

/** Overlay frames read after the one that opened it. */
const HELD_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the world drawn beneath the level-up overlay, where the tick left it", async () => {
  const posed = await isolate(h);
  await primePlacement(
    h,
    POSED.map((entry) => entry.type),
  );

  const at = posed.run.player;
  const types = new Map<number, EnemyId>();
  for (const entry of POSED) {
    const enemy = await placeEnemy(
      h,
      entry.type,
      at.x + entry.dx,
      at.y + entry.dy,
    );
    types.set(enemy.id, entry.type);
  }

  const playing = await h.step(1);
  assertEqual(playing.screen, "playing", "the screen the world was read on");
  const before = await placementOf(h, playing, types, "the last playing frame");

  await h.debug.setPendingLevelUps(1);
  const opened = await h.step(1);
  assertEqual(
    opened.screen,
    "levelup",
    "the screen a playing tick ending with a level-up queued opens " +
      "(specs/world.md)",
  );
  assertGreaterThan(
    (opened.run.offers ?? []).length,
    0,
    "the offers the overlay opened with (specs/progression.md)",
  );
  assertSamePlacement(
    before,
    await placementOf(h, opened, types, "the frame that opened the overlay"),
    "the frame that opened the overlay",
  );

  for (let frame = 1; frame <= HELD_FRAMES; frame += 1) {
    const held = await h.step(1);
    assertEqual(
      held.screen,
      "levelup",
      `the screen on overlay frame ${frame}, which nothing here leaves ` +
        "(specs/ui.md)",
    );
    assertSamePlacement(
      before,
      await placementOf(h, held, types, `overlay frame ${frame}`),
      `overlay frame ${frame}`,
    );
  }
  await captureStill(h, "beneath");
});
