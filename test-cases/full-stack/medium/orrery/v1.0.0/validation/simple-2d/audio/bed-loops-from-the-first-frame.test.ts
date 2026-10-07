// audio/bed-loops-from-the-first-frame — the music bed is already looping on the
// first frame the game runs, on the title screen.
//
// THE RULE. `specs/ui.md`'s cue table gives `music` one line of its own —
// "`CUES.music` | Loops from the first frame, on every screen" — and the
// paragraph under it says it again: "`LOOPING_CUES` holds the one cue that loops
// until stopped rather than playing once. `music` is looping on every frame the
// game runs, on `title`, `howto`, `select`, and `editor` alike, in every sim
// status." The first frame the game runs is a frame of the title screen, because
// `reset` "restores every declared field of the game's state to its title-screen
// value" (`specs/instrumentation.md`) and a fresh harness stands there.
//
// AND THE BED HAS NOTHING TO WAIT FOR. `specs/assets.md` requires the whole
// library ready before anything draws — "every asset is decoded and every sound
// is bound to its cue before the first frame draws" — so a bed that is not
// running on the first frame is not waiting on its own file.
//
// THE ONE INPUT THIS CHECK GIVES IS THE UNLOCK, which the point's own description
// allows and which a browser requires of any page before it may sound at all:
// `armAudio` presses `INERT_KEY` (`KeyO`), a key `specs/controls.md` binds to no
// action on any screen, so nothing about the game moves. No screen change, no
// menu key, no pointer.
//
// THE VERDICT. On the first frame after the unlock the build is sounding the bed
// — a looping source is live, or, on a build that re-schedules its buffer end to
// end rather than setting the loop flag, a sound started on that very frame — and
// it is still sounding on every frame after it, with the game still on `title`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNull,
} from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { screensOf, watchBed } from "./bed";

/**
 * How many frames the bed is read over. Long enough that a bed which started and
 * stopped again is caught, short enough that the point costs a fraction of a
 * second: the requirement is about the FIRST frame, and the frames after it are
 * there so "looping" is read as looping rather than as one blip.
 */
const FRAMES = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("is looping on the first frame the game runs, on the title screen", async () => {
  const opening = await h.snapshot();
  assertEqual(
    opening.screen,
    "title",
    "the game stands on the title screen before anything is asked of it, which is the screen this point reads",
  );
  assertNull(
    opening.sim,
    "no run is live on the title screen, so nothing but the bed can sound",
  );

  // The audio unlock, and nothing else: a key bound to no action on any screen.
  await h.armAudio();

  const window = await watchBed(h, FRAMES);

  await captureStill(h, "title");

  const first = window.readings[0];
  assertGreaterThan(
    Math.max(first?.looping ?? 0, (first?.sounds ?? 0) - window.opened),
    0,
    "the bed is running on the first frame the game runs: a looping source is live, or a sound started on that frame",
  );
  assertDeepEqual(
    window.stopped,
    [],
    "and it is still running on every frame after it, so the bed loops rather than sounding once",
  );
  assertDeepEqual(
    screensOf(window),
    ["title"],
    "the bed was read on the title screen throughout: no screen change and no input but the unlock",
  );
});
