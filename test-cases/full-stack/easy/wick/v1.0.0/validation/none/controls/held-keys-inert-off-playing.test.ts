// controls/held-keys-inert-off-playing — held movement keys move nothing off
// playing.
//
// WHAT THIS DECIDES. One thing: the movement actions are held values on
// `playing` ALONE. `ArrowRight` held for sixty frames on `paused`, and sixty
// more on `levelup`, leaves `player.x` where it was posed.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`right` | `ArrowRight`, `KeyD`
//   | held | moves the lamplighter right".
//   specs/controls.md ("Moving the lamplighter"): "On `playing`, the four
//   movement actions are read as held values".
//   specs/controls.md ("What each screen reads"): the `Held` column reads
//   "none" on `paused` and on `levelup`, and "An action a row omits does
//   nothing on that screen."
//   specs/ui.md ("What advances on each screen"): on `levelup`, `chest`, and
//   `paused`, "Nothing. The world beneath holds exactly the tick it was at."
//   specs/instrumentation.md ("`setScreen(name)`"): the pose "Sets `screen` to
//   `name` ... Nothing else changes", so `paused` and `playing` are reached
//   without touching the run; the level-up overlay is "`setPendingLevelUps` and
//   one `playing` tick".
//
// THE DRIVE. An isolated night, the lamplighter posed at `x` `100` so a build
// that resets the position on a screen change is told apart from one that
// holds it: `paused` is posed straight from `playing`, the key is held across
// sixty frames there, play is resumed by the pose that changes nothing, and the
// overlay is opened the real way, by one queued level-up and the tick that
// opens it, with nothing held on that tick. Nothing else in the drive runs a
// tick, so the only thing that could move `x` is a held key read on a screen
// that reads none.
//
// THE TOLERANCE. None: no tick runs, so the posed value is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  holdKeys,
  isolate,
  openLevelUp,
  poseScreen,
  type Harness,
} from "../harness";

/** Where the lamplighter is posed, off the origin a fresh run puts it at. */
const POSED_X = 100;

/** How long the key stays down on each screen: a second of frames. */
const HELD_FRAMES = 60;

/** The first key bound to `right`. */
const RIGHT_KEY = BINDINGS.right[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds player.x under ArrowRight on paused and on levelup", async () => {
  await isolate(h);
  await h.debug.setPlayerPosition(POSED_X, 0);

  const paused = await poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the first screen the key is held on");
  assertEqual(paused.run.player.x, POSED_X, "player.x as posed on paused");
  const heldPaused = await holdKeys(h, [RIGHT_KEY], HELD_FRAMES);

  await h.debug.setScreen("playing");
  const overlay = await openLevelUp(h);
  assertEqual(
    overlay.screen,
    "levelup",
    "the second screen the key is held on",
  );
  assertEqual(overlay.run.player.x, POSED_X, "player.x as posed on levelup");
  const heldOverlay = await holdKeys(h, [RIGHT_KEY], HELD_FRAMES);
  await captureStill(h, "held");

  assertEqual(
    heldPaused.run.player.x,
    POSED_X,
    "player.x after 60 frames of ArrowRight on paused",
  );
  assertEqual(
    heldOverlay.run.player.x,
    POSED_X,
    "player.x after 60 frames of ArrowRight on levelup",
  );
});
