// presentation/animation-holds-off-playing — every animation stands still on a
// screen that is not `playing`.
//
// WHERE THE REQUIREMENT COMES FROM. `specs/assets.md`, Animation: "Every
// animation runs on ticks, so it holds still on every screen but `playing`."
// `specs/ui.md`, "What advances on each screen", is where that comes from:
// `levelup`, `chest`, and `paused` advance "Nothing. The world beneath holds
// exactly the tick it was at", and `specs/instrumentation.md` adds that on
// every screen but `playing` "a frame ticks nothing and the accumulator holds
// `0`". The lamplighter's frame is a function of moved ticks and every enemy's
// of its `age` (`specs/assets.md`), and neither advances while nothing ticks,
// so the drawn frames must not change.
//
// WHAT IS READ. The produced file drawn on the lamplighter and on each of the
// three enemies, on each of sixty frames of `paused`, against the same reading
// on the first of them. Sixty frames is one second of frames at the `TICK_HZ`
// (`60`) `specs/overview.md` fixes, long enough that any animation running off
// frames rather than ticks advances several times over: the enemies are posed
// at ages six ticks apart, so a build that advanced them would be showing a
// different sheet frame within six frames.
//
// THE BOUND. None: the same file names on every frame.
//
// THE WORLD, AND WHY. An isolated world holding three moths at three ages, far
// enough apart that no sprite can be claimed by its neighbour, and the
// lamplighter still at the origin. One `playing` frame runs first, so the
// reading starts from the frames a real tick left; then `setScreen("paused")`,
// which `specs/instrumentation.md` enters by setting `screen` alone, with the
// run left as it stands.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { STAGE_CX, STAGE_CY } from "../constants";
import {
  blitsNearStage,
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  poseScreen,
  type Blit,
  type Harness,
} from "../harness";
import { enemyFiles, framesAt, LAMPLIGHTER_FILES, SPRITE_TOL } from "./sprites";

/** Three moths, posed at ages a frame-step apart, well clear of one another. */
const MOTHS: readonly { x: number; y: number; age: number }[] = [
  { x: 300, y: -120, age: 0.02 },
  { x: -300, y: -120, age: 0.12 },
  { x: 0, y: 240, age: 0.22 },
];

/** How many frames of `paused` are read. */
const HELD_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the lamplighter's and every enemy's drawn frame across a pause", async () => {
  isolate(h);
  for (const moth of MOTHS) {
    const id = placeEnemy(h, "moth", moth.x, moth.y);
    h.debug.setEnemyAge(id, moth.age);
  }
  await h.frameBlits();
  poseScreen(h, "paused");

  const files = enemyFiles("moth");
  let first: (string | null)[] | null = null;
  for (let frame = 1; frame <= HELD_FRAMES; frame += 1) {
    const blits = await h.frameBlits();
    const centre = blitsNearStage(h, blits, STAGE_CX, STAGE_CY, SPRITE_TOL)
      .filter((blit: Blit) => LAMPLIGHTER_FILES.includes(blit.id))
      .map((blit: Blit) => blit.id);
    const reading: (string | null)[] = [
      centre.length === 0 ? null : centre[centre.length - 1],
      ...MOTHS.map((moth) => {
        const frames = framesAt(h, blits, files, moth.x, moth.y);
        return frames === null ? null : frames.join("/");
      }),
    ];
    if (first === null) {
      for (let part = 0; part < reading.length; part += 1) {
        assertNotNull(
          reading[part],
          `a produced sprite drawn on ${part === 0 ? "the lamplighter" : `moth ${part}`} under the pause`,
        );
      }
      first = reading;
      captureStill(h, "held");
      continue;
    }
    assertEqual(
      reading.join(","),
      first.join(","),
      `the lamplighter's and the three moths' drawn frames on paused frame ${frame}`,
    );
  }
});
