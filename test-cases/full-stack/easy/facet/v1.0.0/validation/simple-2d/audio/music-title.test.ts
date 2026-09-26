// Facet — audio/music-title: a produced piece of music is looping on the title
// screen.
//
// specs/assets.md, under Audio: "Produce two pieces: a title theme with a hook,
// and a slower play bed that sits under a round". specs/ui.md, under Audio: "The
// title theme loops on `title` and `howto`, and the play bed loops on `playing`,
// `paused`, `levelclear`, and `gameover`. One of the two is playing on every
// screen."
//
// THE PIECE A ROUND IS PLAYED UNDER IS ITS OWN POINT. `audio/music-round` reads
// the far side of the one boundary specs/ui.md puts between the two pieces: a
// build that ships a title theme and no play bed passes here and fails there.
//
// WHY THE TITLE SCREEN IS WHERE THIS IS READ. Not one of the nine events in
// specs/ui.md's CUES table can fire there: no cell is selected, no swap is made
// or refused, no chain step clears or lands, no gem reaches MAX_STRAIN, no cut
// gem is created, no level completes and no round ends. So a sound heard on the
// title is music, and nothing else it could be.
//
// LOOPING STARTS, NOT SOUNDS IN GENERAL. The harness holds the two apart: a
// source that loops is a bed, and a one-shot is a cue. Reading the looping
// channel is what keeps a cue from answering a question about music, and it is
// the reading specs/ui.md's own word — "loops" — asks for. The `none` counterpart
// cannot make that separation, since there the whole audio layer is inside the
// build, and reads that a sound went out at all instead; the asymmetry is
// expected.
//
// THE WAIT IS REAL TIME AS WELL AS FRAMES. specs/assets.md has the produced
// `.wav`s decoded with the Web Audio API, which is asynchronous, so a build is
// entitled to reach for its title theme on the first frame and start it once the
// decode lands.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("loops a piece on the title screen", async () => {
  // The screen the first half is read on, before anything is driven.
  assertEqual(h.snapshot().screen, "title", "the screen the game opens on");

  // Open the build's audio and wait, in real time, until it has actually made a
  // sound: a build whose first frames are silent while its produced `.wav`s
  // decode is conformant, and reading them would be reading the decoder.
  assertEqual(await h.warmAudio(), true, "the build ever made a sound");
  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the sound was heard on",
  );
  captureStill(h, "music");

  // A looping source is playing, and on this screen music is the only thing it
  // can be.
  assertGreaterThan(
    h.loops.length,
    0,
    "looping music started while the title screen stood",
  );
});
