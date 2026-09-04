// Facet — audio/music-title: a produced piece of music is playing on the title
// screen.
//
// specs/assets.md, under Audio: "Produce two pieces: a title theme with a hook,
// and a slower play bed that sits under a round". specs/ui.md, under Audio: "The
// title theme loops on `title` and `howto`, and the play bed loops on `playing`,
// `paused`, `levelclear`, and `gameover`. One of the two is playing on every
// screen."
//
// THE PIECE THE ROUND BRINGS IN IS ITS OWN POINT. `audio/music-round` reads the
// far side of the one boundary specs/ui.md puts between the two pieces: a build
// that ships a title theme and no play bed passes here and fails there.
//
// WHY THE TITLE SCREEN IS WHERE THIS IS READ. Not one of the nine events in
// specs/ui.md's CUES table can fire there: no cell is selected, no swap is made
// or refused, no chain step clears or lands, no gem reaches MAX_STRAIN, no cut
// gem is created, no level completes and no round ends. So a sound heard on the
// title is music, and nothing else it could be.
//
// HOW IT IS READ. With `warmAudio`, which waits in real time until the build has
// actually emitted a sound, however that sound was scheduled. A build is
// entitled to start a piece OFF the frame loop, since specs/assets.md decodes the
// produced `.wav`s with `decodeAudioData`, which is asynchronous, so a piece
// asked for on one frame may legitimately begin when the decode lands between two
// frames. On this screen the wait answers the question exactly: something is
// sounding, and it can only be music.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays a piece on the title screen", async () => {
  // The screen the first half is read on, before anything is driven.
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the game opens on",
  );

  // Open the build's audio and wait, in real time, until it has actually made a
  // sound: a build whose first frames are silent while its produced `.wav`s
  // decode is conformant, and reading them would be reading the decoder. On the
  // title screen no cue event exists to make a sound, so what this waits for is a
  // piece of music playing.
  assertEqual(
    await h.warmAudio(),
    true,
    "a sound going out on the title screen",
  );
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the sound was heard on",
  );
  await captureStill(h, "music");
});
