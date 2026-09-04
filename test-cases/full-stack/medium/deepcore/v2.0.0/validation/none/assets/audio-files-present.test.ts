// assets/audio-files-present — every named cue has a real sound behind it.
//
// `specs/assets.md` names thirteen sounds and the file each lands at, under
// `assets/audio/<name>.wav`, and closes on the bar: "A build that ships ... silence
// has not done this work, however good the simulation is." So each of the thirteen
// is read off disk and DECODED — by the page's own Web Audio decoder, the same one
// a build's playback goes through — and held to being real audio with something in
// it.
//
// Three ways a cue can be wired to nothing, and all three fail here: the file is
// missing, the file is not audio a browser will decode, or the file decodes to
// silence. The last is what a placeholder looks like: a well-formed `.wav` of the
// right length whose every sample is zero. A peak above zero is the whole of what
// "not silent" can mean without assuming a loudness `specs/assets.md` never fixed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { readSound } from "./produced";
import { AUDIO_FILES } from "../constants";

/** The shortest a produced cue can be and still be a sound, in seconds. */
const SHORTEST = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("decodes all thirteen produced sounds, none of them silent", async () => {
  const faults: string[] = [];
  for (const name of AUDIO_FILES) {
    const file = `assets/audio/${name}.wav`;
    const sound = await readSound(h, "audio", `${name}.wav`).catch(
      () => "undecodable" as const,
    );
    if (sound === "undecodable") faults.push(`${file}: does not decode`);
    else if (sound === null) faults.push(`${file}: missing`);
    else if (sound.seconds < SHORTEST) faults.push(`${file}: empty`);
    else if (sound.peak <= 0) faults.push(`${file}: silent`);
  }
  await captureStill(h, "audio");

  assertEqual(faults.join(", "), "", "specs/assets.md");
});
