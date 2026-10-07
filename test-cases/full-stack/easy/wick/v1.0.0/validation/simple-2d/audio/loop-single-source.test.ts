// Wick — audio/loop-single-source: across 120 frames of a looping `music` cue
// exactly one source of it is playing, and a second start request while it
// loops changes nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`api.audio.loop` starts a cue looping,
//     `api.audio.stop` ends it, and `api.audio.looping` reports whether it is;
//     a file-backed cue loops its decoded buffer seamlessly, and a cue is
//     either looping or not."
//   - specs/ui.md (The loops): "`music` is looping on every frame exactly when
//     `screen` is `playing` ...", and "Both loops are reconciled from the state
//     on every frame", so the loop is answered for on all 120 frames and any
//     re-request lands inside them.
//   - specs/ui.md (Audio): "Loops are started and stopped from `update`".
//
// WHAT IS READ. Two counts taken across the 120 frames: how many sounds the
// engine's bus started for `music`, which must be exactly one, and how many
// loops it started at all, which must be exactly one too. A build that
// restarted the cue every frame, or laid a second loop over the first, shows up
// as a count above one; the cue is read as still looping at the end so the one
// source is the live one and not a loop that stopped.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon held, and every driver switch off, so the screen stays `playing`
// for all 120 frames and nothing can stop the loop or start another. No Halo or
// Corona is held, so `hum` never loops and the loop count belongs to `music`
// alone. The counts are taken as differences across the drive, so anything the
// harness's own startup sounded stays out of the reading.
//
// TOLERANCE. None. Both readings are counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  soundsOf,
  type Harness,
} from "../harness";

/** The span the review item names, 120 frames of the looping cue. */
const FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("sounds the music loop through one source across 120 frames", async () => {
  isolate(h);
  const sourcesBefore = soundsOf(h, "music").length;
  const startsBefore = h.loopStarts();

  const after = await captureReplay(h, "single", () => h.tick(FRAMES));

  assertEqual(after.screen, "playing", "the screen across the frames");
  assertEqual(h.looping("music"), true, "music looping at the last frame");
  assertEqual(
    soundsOf(h, "music").length - sourcesBefore,
    1,
    "sources the bus started for music across the frames",
  );
  assertEqual(
    h.loopStarts() - startsBefore,
    1,
    "loops the bus started across the frames",
  );
});
