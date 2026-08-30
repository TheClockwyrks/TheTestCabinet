// audio/mute-silences — with sound muted, the events that carry cues carry none,
// and the snapshot reports muted throughout.
//
// `specs/ui.md`: "the `mute` action toggles it from any screen. While sound is
// muted every cue is silent and the game stays fully playable."
// `specs/instrumentation.md` has `muted` as "the game's copy of the runtime's
// mute bit, refreshed in every update", and gives the surface NO operation that
// sets it — so mute is reached the way a player reaches it, through the `KeyM`
// binding `specs/controls.md` fixes, and read back off the snapshot.
//
// THE BOARD STARTS UNMUTED, WHICH IS THE PRECONDITION THAT MAKES THE READING
// MEAN ANYTHING. A build that opened already muted would be silent here for a
// reason that has nothing to do with the toggle, so the bit is read before the
// key and after it, and the toggle is what turns one into the other.
//
// THREE EVENTS, ONE FROM EACH CORNER OF THE CUE TABLE, so a build that silenced
// one path and not another is caught: a menu highlight moving on the title, a
// bolt fired during play, and a bolt destroying a worm segment. Each is driven
// through the build's own code — real keys through Chromium's input pipeline, a
// real bolt resolving through the game's own shot rules — and each is confirmed
// to have HAPPENED, because a muted build that also stopped playing would be
// silent for the wrong reason.
//
// SILENCE IS READ TWO WAYS, and both have to hold. `watchCues` hears every sound
// attributed to a driven frame; `sounds()` counts every sound the page has
// emitted since it loaded, frames or not, which also catches a build that makes
// its noise straight from a key's event handler.
//
// WHAT "SILENT" IS TAKEN TO MEAN. A muted cue starts no sound at all. That is the
// reading `specs/ui.md`'s "every cue is silent" is held to here and the one the
// review item states; a build that instead kept starting its sources at a gain of
// zero would be inaudible to a listener and would still fail this point. See the
// stage report — the specification should say which of the two it means.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWorm,
  segmentTiles,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";
import { fireBolt, moveHighlight, shootSegment } from "./cues";

/** The worm the muted cut is taken out of, on a tile clear of the band. */
const TARGET = { c: 12, r: 8 } as const;
const LENGTH = 3;

/** Quiet play driven after each event, so a late blip is still caught. */
const SETTLE_FRAMES = framesFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("plays nothing at all on a fire, a cut or a menu move while muted", async () => {
  // The harness has already reset the game, so this is the title. `reset` leaves
  // the mute bit exactly as it stands (`specs/instrumentation.md`), and a fresh
  // page has never touched it.
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).muted,
    false,
    "the mute bit a fresh page reports before the key is pressed",
  );

  await h.armAudio();
  await h.tap("KeyM");
  assertEqual(
    (await h.snapshot()).muted,
    true,
    "the mute bit after one press of KeyM",
  );

  // Watched from here, so nothing before the toggle can be counted against it.
  const played = watchCues(h);
  const totalBefore = await h.sounds();

  // A menu highlight moving, on the title the game opened on.
  const moved = await moveHighlight(h);
  await h.advance(SETTLE_FRAMES);
  const afterMove = await h.snapshot();

  // A bolt fired, on an empty live board.
  await startPlaying(h);
  const fired = await fireBolt(h);
  await h.advance(SETTLE_FRAMES);
  const afterFire = await h.snapshot();

  // A bolt destroying a worm segment.
  await poseWorm(h, {
    c: TARGET.c,
    r: TARGET.r,
    length: LENGTH,
    stepping: false,
  });
  const cut = await shootSegment(h, TARGET);
  await h.advance(SETTLE_FRAMES);
  const afterCut = await h.snapshot();

  const totalAfter = await h.sounds();
  await captureStill(h, "muted");

  // Each event really happened: the game stayed fully playable while muted.
  assertEqual(
    moved.hit,
    true,
    "the held movement action to move the highlight",
  );
  assertEqual(fired.hit, true, "the held fire action to put a bolt in flight");
  assertEqual(cut.hit, true, "the bolt to destroy a worm segment");
  assertEqual(
    segmentTiles(cut.snapshot).length,
    LENGTH - 1,
    "the segments still standing after the muted cut",
  );

  // And the bit held throughout, event by event.
  assertEqual(afterMove.muted, true, "the mute bit after the menu move");
  assertEqual(afterFire.muted, true, "the mute bit after the shot");
  assertEqual(afterCut.muted, true, "the mute bit after the cut");

  assertLength(played, 0, "the sounds emitted on any frame of the muted drive");
  assertEqual(
    totalAfter - totalBefore,
    0,
    "the sounds the page emitted across the muted drive, frames or not",
  );
});
