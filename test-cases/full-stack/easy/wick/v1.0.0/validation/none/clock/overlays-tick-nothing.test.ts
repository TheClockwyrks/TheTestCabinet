// clock/overlays-tick-nothing — the level-up and chest overlays tick nothing.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("What advances on each screen"):
// on `levelup`, `chest`, and `paused`, "Nothing. The world beneath holds
// exactly the tick it was at." specs/progression.md: "the simulation does not
// tick while it is open, so the world behind it is frozen exactly as that tick
// left it", and of the chest overlay, "The simulation does not tick while the
// overlay is open". specs/instrumentation.md, of `step`: "On every other
// screen the update ticks nothing: the menu edges are read, the loops are
// reconciled, `muted` is mirrored, and `run.tick` is untouched." What holds is
// the whole of `run`: `tick`, every entity's position and age, every timer,
// every cooldown, every `ttl`.
//
// THE DRIVE. The live night of `./stage`, with a moth walking, a bolt flying, a
// gem in flight, a puddle's `ttl`, a contact cooldown, and Taper's timer all
// counting, so that a tick the build ran under the overlay by mistake would
// move at least six figures. The level-up overlay is opened by the real path,
// a queued level-up and the tick that opens it (specs/progression.md: "A
// `playing` tick that ends with `pendingLevelUps` above `0` runs to completion
// and then opens the overlay"); the chest overlay by a chest at the
// lamplighter's feet and the tick that collects it (specs/world.md: "Opens the
// chest overlay"). Sixty frames then run on each, and `run` is read against the
// state the opening tick left. The chest is reached from a fresh pose rather
// than through `choose`, which belongs to the progression checks.
//
// THE TOLERANCE. None: a world that ticked nothing holds identical numbers, so
// the comparison is `assertDeepEqual` over the whole of `run`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openChest,
  openLevelUp,
  type Harness,
} from "../harness";
import { poseLiveNight } from "./stage";

/** The frames run on each overlay: a second of wall-clock frames. */
const HELD_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the world exactly where the opening tick left it, on levelup and on chest", async () => {
  await poseLiveNight(h);
  const levelUpOpened = await openLevelUp(h);
  const levelUpHeld = await h.step(HELD_FRAMES);

  await poseLiveNight(h);
  const chestOpened = await openChest(h);
  const chestHeld = await h.step(HELD_FRAMES);
  await captureStill(h, "frozen");

  assertEqual(
    levelUpOpened.screen,
    "levelup",
    "the screen the tick with a level-up queued left",
  );
  assertEqual(
    levelUpHeld.screen,
    "levelup",
    "the screen after 60 frames on levelup",
  );
  assertDeepEqual(
    levelUpHeld.run,
    levelUpOpened.run,
    "the run after 60 frames on levelup, against the run the opening tick left",
  );

  assertEqual(
    chestOpened.screen,
    "chest",
    "the screen the tick that collected the chest left",
  );
  assertEqual(chestHeld.screen, "chest", "the screen after 60 frames on chest");
  assertDeepEqual(
    chestHeld.run,
    chestOpened.run,
    "the run after 60 frames on chest, against the run the collecting tick left",
  );
});
