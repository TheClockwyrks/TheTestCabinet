// Arc Foundry — audio/music: the music bed plays from the first build phase and
// loops rather than ending.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.music` is "looped
// under the yard from the first build phase onward", and, below the table, "The
// music cue loops until the game ends." `specs/assets.md` renders it with `music`,
// as "a tense, driving industrial bed, looped under the yard".
//
// HOW LOOPING IS OBSERVED, AND WHY IT IS NOT TIMED. A bed that outlasts its own
// file is a bed a browser was told to repeat: every way of playing audio in a
// browser carries that instruction on the thing being played — `loop` on a Web
// Audio source node, `loop` on an `<audio>` element — and a source started once
// with it set sounds until it is stopped. So what this reads is the sound the
// build actually started: the harness's own probe watches both of those doors
// from before a line of the build ran and records whether each sound was started
// as a loop, and this reads the count across the moment the run opens. Waiting
// out the file instead would mean holding the validator for however long a
// build's bed happens to be, and would decide the same thing.
//
// WHAT IS ASSERTED. That the build started a sound once the run opened, and that
// one of the sounds it started then was started as a loop. The run is opened
// through `startRun`, which `specs/instrumentation.md` says "opens it on its
// first build phase" — so what is being listened to is exactly the moment the
// requirement names. Both counts are read as the GROWTH across that moment, so
// whatever the build sounded on its title screen is not what is being read.
//
// WHAT CANNOT BE SEPARATED. Which sound was the bed. The name of a sound is not
// observable from outside an engineless build, so a build that loops some other
// cue and never plays a bed would pass this; that half is the reviewer's, by ear.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  openRun,
  type Harness,
} from "../harness";
import { firstSound } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("starts a looping sound when the run opens on its first build phase", async () => {
  const before = { sounds: await h.sounds(), loops: await h.loopStarts() };

  const opened = await captureReplay(h, "music", async () => {
    await openRun(h);
    // A browser opens an audio context asynchronously, so the bed cannot start on
    // the first frame of the build phase however conformant the build is.
    // `firstSound` drives a fixed stretch of the build phase and waits on the
    // state the build reaches between the rounds of it, so the same frames land
    // on any machine and nothing here waits on real time.
    await firstSound(h, before.sounds);
    return { sounds: await h.sounds(), loops: await h.loopStarts() };
  });

  assertGreaterThan(
    opened.sounds - before.sounds,
    0,
    "the sounds the build started once the run had opened on its first build " +
      "phase, where specs/ui.md loops the music bed under the yard",
  );
  assertGreaterThan(
    opened.loops - before.loops,
    0,
    "the sounds the build started on its first build phase that were started " +
      "as a loop, so the bed sounds past the end of its own file (specs/ui.md)",
  );
});
