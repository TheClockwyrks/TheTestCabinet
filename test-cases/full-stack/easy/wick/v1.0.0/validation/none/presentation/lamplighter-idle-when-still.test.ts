// presentation/lamplighter-idle-when-still — a tick on which the lamplighter did
// not move draws the produced idle sprite.
//
// THE REQUIREMENT. `specs/assets.md` — "Animation": "The lamplighter draws the
// walk sheet on a tick with a non-zero movement direction and the idle sprite on
// every other tick." This point decides the second half of that sentence; the
// walk cycle is `presentation/lamplighter-walks-while-moving`.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held and
// no key down: `specs/world.md` makes the movement direction "the sum of the unit
// vectors of the held actions", so no key held is exactly a tick with no movement
// direction. Nothing else is on the field, so the only `24 x 32` sprite the frame
// can draw is the lamplighter's.
//
// WHAT IS READ, AND WHY IT IS THE FAIR READING. Which of the seven produced files
// the frame drew, decided by the file's own pixels rather than by its URL, which
// a bundler renames. `specs/assets.md` fixes the idle sprite at
// `assets/sprites/lamplighter/idle.png` and the walk cycle at `walk/0.png` to
// `5.png`, so "the idle sprite rather than a walk frame" is a question about
// WHICH FILE, and that is the question asked.
//
// The reading is taken twice, and the second is what makes the point sharp: a
// still tick from a standing start, and a still tick immediately after six ticks
// of movement, which is where a build that latches the walk cycle on and never
// lets go of it fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { primeSources } from "./sources";
import { LAMPLIGHTER_FILES, postureName, postureOf } from "./walk";

/** Ticks of held movement before the second reading, one walk frame's worth. */
const MOVED_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the idle sprite on a tick with no movement direction", async () => {
  await isolate(h);
  await primeSources(h, LAMPLIGHTER_FILES);

  await h.step(1);
  const standing = await postureOf(h, await h.lastCalls());
  await captureStill(h, "idle");
  assertTrue(
    standing.idle,
    "the produced idle sprite on a tick with no key held, rather than " +
      `${postureName(standing)} (specs/assets.md)`,
  );

  await h.hold("ArrowRight");
  await h.step(MOVED_TICKS);
  await h.release("ArrowRight");

  const stopped = await postureOf(h, await h.step(1).then(() => h.lastCalls()));
  assertTrue(
    stopped.idle,
    "the produced idle sprite on the first still tick after six moved ones, " +
      `rather than ${postureName(stopped)} (specs/assets.md)`,
  );
});
