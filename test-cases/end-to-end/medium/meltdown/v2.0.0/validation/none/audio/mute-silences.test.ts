// audio/mute-silences — with sound muted, the events that carry all ten cues carry
// none of them.
//
// `specs/audio.md`, under Mute: "The build owns the mute bit. It is toggled by the
// `mute` action and by the panel's mute control, from any screen ... While muted,
// none of the ten cues produces any sound: the build plays no muted cue at all,
// starting no audio source and playing no clip for it." `specs/instrumentation.md`
// gives the surface NO operation that sets it — "There is no operation that sets
// muting: `mute` is reached the way a player reaches it, through its binding in
// `specs/controls.md` or the panel's mute control, and the snapshot reports the
// result" — and reports `muted` as "the game's copy of the runtime's mute bit,
// refreshed in every update". So mute is reached through `KeyM` and read back off
// the snapshot.
//
// WHY THIS ITEM IS `none` ALONE. Under `none` the BUILD owns the mute bit and the
// specification puts the silencing on the build: it plays no muted cue at all.
// Under an engine the same specification puts it on the engine — "the engine plays
// each of them at an amplitude of zero" — so a check on the silence there returns
// the same verdict for every build on that engine. What stays every engine's is
// that the game goes on resolving the events muted, and that is
// `audio.mute-changes-nothing-else`.
//
// THE PAGE STARTS UNMUTED, WHICH IS THE PRECONDITION THAT MAKES THE READING MEAN
// ANYTHING. A build that opened already muted would be silent here for a reason
// that has nothing to do with the toggle, so the bit is read before the key and
// after it, and the toggle is what turns one into the other. Audio is armed with a
// real gesture first, so the silence is a build that COULD have sounded choosing
// not to.
//
// THE DRIVE IS `every-cue.ts`'s, and it reaches all ten cues' events on the real
// path each of them is reached on.
//
// SILENCE IS READ TWO WAYS, AND BOTH HAVE TO HOLD. `watchCues` hears every sound
// attributed to a driven frame; `sounds()` counts every sound the page has emitted
// since it loaded, frames or not, which also catches a build that makes its noise
// straight from a key's or a pointer's event handler rather than from its loop.
//
// WHAT IT DOES NOT DECIDE. That every event the drive carries still resolves with
// the bit set is `audio.mute-changes-nothing-else`, which runs the same drive and
// reads the game rather than the bus.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  watchCues,
  type Harness,
} from "../harness";
import { DIFFICULTY, MODE, driveEveryCue } from "./every-cue";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("plays nothing at all through every one of the ten cues' events", async () => {
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
  await tapAction(h, "mute");
  assertEqual(
    (await h.snapshot()).muted,
    true,
    "the mute bit after one press of the key specs/controls.md binds mute to",
  );

  // Watched from here, so nothing before the toggle can be counted against it.
  const played = watchCues(h);
  const totalBefore = await h.sounds();

  const drive = await driveEveryCue(h);

  const totalAfter = await h.sounds();
  await startRun(h, MODE, DIFFICULTY);
  await h.advance(1);
  await captureStill(h, "muted");

  /* -- The bit held throughout, so the drive really ran muted --------------- */
  assertEqual(
    drive.moved.snapshot.muted,
    true,
    "the mute bit after the menu move",
  );
  assertEqual(drive.placed.muted, true, "the mute bit after the placement");
  assertEqual(drive.sold.snapshot.muted, true, "the mute bit after the sale");
  assertEqual(drive.kill.snapshot.muted, true, "the mute bit after the kill");
  assertEqual(drive.trip.snapshot.muted, true, "the mute bit after the trip");
  assertEqual(drive.won.snapshot.muted, true, "the mute bit after the win");
  assertEqual(drive.lost.snapshot.muted, true, "the mute bit after the loss");

  /* -- Nothing sounded, on any frame or off one ----------------------------- */
  assertGreaterThan(
    h.frame(),
    0,
    "the frames the muted drive ran, so the silence covers real play",
  );
  assertLength(played, 0, "the sounds emitted on any frame of the muted drive");
  assertEqual(
    totalAfter - totalBefore,
    0,
    "the sounds the page emitted across the muted drive, frames or not",
  );
});
