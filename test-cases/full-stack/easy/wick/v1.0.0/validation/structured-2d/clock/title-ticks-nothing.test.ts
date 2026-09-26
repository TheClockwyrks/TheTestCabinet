// Wick — clock/title-ticks-nothing: nothing advances on title.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/overview.md` ("Units, ticks, the world, and the camera"): "Only
//     the `playing` screen ticks; the level-up and chest overlays and every
//     other screen tick nothing".
//   - `specs/state.md` ("The idle run"): "`run` holds the values below
//     whenever `screen` is `title`, `howto`, or `almanac`", with the table:
//     tick, level,
//     xp, kills `0`, `1`, `0`, `0`; the player at the origin facing right with
//     `BASE_MAX_HP`; every list empty; `pendingLevelUps` `0`; `spawnTimer` `0`;
//     `nextId` `0`. That table is `IDLE_RUN` in `harness.ts`, with the derived
//     fields of `specs/instrumentation.md` ("Snapshot shape") beside it.
//   - `specs/instrumentation.md` (`reset`): restores "the `title` screen with
//     `menuIndex`, `almanacTab`, and `almanacScroll` all `0`, the idle run of
//     `specs/state.md`, ... and every driver switch on." So the director's
//     switch is ON here, and a title that
//     ticked would spawn on its first tick ("A spawn therefore lands on the
//     first tick of a run", `specs/enemies.md`).
//   - `specs/instrumentation.md` (`setScreen`): "Sets `screen` to `name` ...
//     Nothing else changes", so the pose to `howto` carries the idle run
//     `reset` restored across with it."
//
// THE DRIVE. `reset`, which leaves the game on `title` with every switch on,
// then sixty frames; then `howto` through the surface and sixty more. After
// each, the run must still be the idle run: tick `0`, no enemy (nothing
// spawned), and every other idle value in place.
//
// TOLERANCE. None: the idle run is a table of exact values.
//
// The other screen is `clock/howto-ticks-nothing`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  IDLE_RUN,
  type Harness,
} from "../harness";

/** Frames run on the screen: a second of the clock. */
const IDLE_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the idle run at tick 0 with nothing spawned across frames on title", async () => {
  h.reset();
  await h.advance(IDLE_FRAMES);
  const held = h.snapshot();
  captureStill(h, "idle");

  assertEqual(held.screen, "title", "the screen after sixty frames on title");
  assertDeepEqual(
    held.run,
    IDLE_RUN,
    "the run after sixty frames on title, against the idle run",
  );
});
