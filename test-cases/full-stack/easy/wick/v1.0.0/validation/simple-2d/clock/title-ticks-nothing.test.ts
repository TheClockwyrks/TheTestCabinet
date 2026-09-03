// Wick — clock/title-ticks-nothing: nothing advances on title and howto.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/ui.md` ("What advances on each screen"): "`title`, `howto`,
//     `almanac` | Nothing."
//   - `specs/instrumentation.md` ("Snapshot shape"): "`run` reports the idle
//     run of `specs/state.md` on `title`, `howto`, and `almanac`".
//   - `specs/state.md` ("The idle run"): "`run` holds the values below whenever
//     `screen` is `title`, `howto`, or `almanac`", with `tick` `0` and
//     `enemies` empty among them.
//   - `specs/instrumentation.md` (`reset`): restores "the `title` screen with
//     `menuIndex`, `almanacTab`, and `almanacScroll` all `0`, the idle run of
//     `specs/state.md` ... and every driver switch on"; (`setScreen`):
//     "`howto` | any | Enters the how-to screen exactly as confirming
//     `HOW TO PLAY` does: the idle run."
//
// WHAT IS READ. From a reset, with every driver switch on as a reset leaves it,
// sixty frames are delivered on `title`; then `howto` is entered through the
// surface and sixty more are delivered there. On each, `run` after the frames
// must equal `run` before them, its tick must be 0, and no enemy may have
// spawned: the director, on and with its timer at 0, gets no tick to spawn on.
//
// WHY THE NIGHT IS POSED AS IT IS. The reset is the pose: it is what puts the
// game on the title with the idle run and every switch on, so anything that
// ticked would have the director spawn on its first tick. The how-to screen is
// entered by its own transition rather than through the menu, so a broken menu
// fails the menu points and not this one.
//
// TOLERANCE. None: the run is compared structurally and the tick is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** How many frames are delivered on each screen: one second of them. */
const IDLE_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the idle run at tick 0 across frames on title and howto", async () => {
  h.reset();
  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen a reset leaves");
  await h.tick(IDLE_FRAMES);
  const idleOnTitle = h.snapshot();
  captureStill(h, "idle");

  assertEqual(idleOnTitle.screen, "title", "screen after frames on title");
  assertEqual(idleOnTitle.run.tick, 0, "run.tick after frames on title");
  assertEqual(
    idleOnTitle.run.enemies.length,
    0,
    "enemies after frames on title",
  );
  assertDeepEqual(idleOnTitle.run, title.run, "run after frames on title");

  h.debug.setScreen("howto");
  const howto = h.snapshot();
  assertEqual(howto.screen, "howto", "the screen the pose entered");
  await h.tick(IDLE_FRAMES);
  const idleOnHowto = h.snapshot();

  assertEqual(idleOnHowto.screen, "howto", "screen after frames on howto");
  assertEqual(idleOnHowto.run.tick, 0, "run.tick after frames on howto");
  assertEqual(
    idleOnHowto.run.enemies.length,
    0,
    "enemies after frames on howto",
  );
  assertDeepEqual(idleOnHowto.run, howto.run, "run after frames on howto");
});
