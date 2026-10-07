// presentation/chest-draws-world-beneath — the chest overlay is drawn OVER the
// world, which stays exactly where the tick that opened it left it.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md` — "chest": "An overlay over the
// held world, opened as `specs/progression.md` states." Under "What advances on
// each screen", `chest` advances "Nothing. The world beneath holds exactly the
// tick it was at." `specs/overview.md` names the same thing among what a player
// reads at a glance: "The level-up overlay, the chest overlay, and the pause
// screen read over the frozen world beneath them, with that world visibly
// quieted."
//
// HOW THE OVERLAY IS OPENED. Through the one route the specification gives it:
// `specs/instrumentation.md` says "The chest overlay is reached through
// `spawnPickup("chest", x, y)` at the lamplighter's center and one tick, which is
// the real collection path." No elite is killed and no menu is pressed on the way,
// because a build with a broken elite and a working overlay must fail the elite's
// points and pass this one.
//
// WHY IT IS ITS OWN POINT. The chest overlay and the level-up overlay are opened
// by different phases of a tick and drawn by different code, so a build that keeps
// the world beneath one and drops it beneath the other has missed exactly one of
// them, and the grade should say which.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, and
// two enemies of different types posed at different places, so the reading is over
// something that can be told apart and can be seen to move if it moves. Nothing is
// held, so the chest's result is the fallback heal `specs/evolutions.md` gives it
// and no evolution runs under the reading.
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
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placePickup,
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

it("keeps the world drawn beneath the chest overlay, where the tick left it", async () => {
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

  await placePickup(h, "chest", playing.run.player.x, playing.run.player.y);
  const opened = await h.step(1);
  assertEqual(
    opened.screen,
    "chest",
    "the screen a playing tick that collected a chest opens " +
      "(specs/world.md)",
  );
  assertNotNull(
    opened.run.chestResult,
    "the result the chest overlay opened with (specs/progression.md)",
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
      "chest",
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
