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
//   specs/instrumentation.md ("`setScreen(name)`"): `paused` from `playing` is
//   "Exactly as `pause` does"; `playing` from `paused` "Resumes exactly as
//   `pause` on `paused` does; the run is untouched"; `levelup` from `playing`
//   with `pendingLevelUps` at least `1` "Opens the overlay exactly as the end of
//   a `playing` tick opens it".
//
// THE DRIVE. An isolated night, the lamplighter posed at `x` `100` so a build
// that resets the position on a screen change is told apart from one that
// holds it, and no tick runs at any point: `paused` is posed straight from
// `playing`, the key is held across sixty frames there, play is resumed by the
// pose that changes nothing, one level-up is queued and the overlay posed open,
// and the key is held across sixty frames there too. Every route is a pose, so
// the only thing that could move `x` is a held key read on a screen that reads
// none.
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
  await h.debug.setPendingLevelUps(1);
  const overlay = await poseScreen(h, "levelup");
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
