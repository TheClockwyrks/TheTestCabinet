// assets/audio-files-present — every named cue has a real sound behind it.
//
// `specs/assets.md` names thirteen sounds and the file each lands at, under
// `assets/audio/<name>.wav`, and closes on the bar: "A build that ships ... silence
// has not done this work, however good the simulation is." So each of the thirteen
// is read off disk and DECODED — the RIFF/WAVE container the contract states, its
// format chunk and its samples — and held to being real audio with something in
// it.
//
// Three ways a cue can be wired to nothing, and all three fail here: the file is
// missing, the file is not audio a decoder will read, or the file decodes to
// silence. The last is what a placeholder looks like: a well-formed `.wav` of the
// right length whose every sample is zero. A peak above zero is the whole of what
// "not silent" can mean without assuming a loudness `specs/assets.md` never fixed.
//
// THE ENGINE'S OWN LOADER CANNOT DECIDE THIS. `engine/audio.md` binds a cue to a
// produced file through the asset loader, and that decode needs an audio context
// no Node process has — so the sounds are read here rather than through the build.
// That the build asks for the right cue at the right moment is what the `audio/`
// points decide; that there is a real sound behind each name is this one.

import { afterEach, beforeEach, it } from "vitest";
import { AUDIO_FILES, BAND_HEALTH, PLAYABLE_COL_MIN } from "../constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  layFloor,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { readSound } from "./produced";

/** The shortest a produced cue can be and still be a sound, in seconds. */
const SHORTEST = 0.01;

/** Where the still is taken: a coreshell cell held under the drill. */
const ROW = 450;
const COL = PLAYABLE_COL_MIN + 8;

/** Frames the cut runs for before the picture is taken. */
const CUTTING = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("decodes all thirteen produced sounds, none of them silent", async () => {
  const faults: string[] = [];
  for (const name of AUDIO_FILES) {
    const file = `assets/audio/${name}.wav`;
    let sound;
    try {
      sound = readSound("audio", `${name}.wav`);
    } catch (error) {
      faults.push(
        `${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (sound === null) faults.push(`${file}: missing`);
    else if (sound.seconds < SHORTEST) faults.push(`${file}: empty`);
    else if (sound.peak <= 0) faults.push(`${file}: silent`);
  }

  // The game playing, as the picture the review item declares: a cut running, which
  // is the moment the most of the thirteen are sounding at once.
  openScene(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  pinMiner(h);
  h.debug.setTileHealth(COL, ROW, BAND_HEALTH.coreshell);
  h.hold(ACTION_KEY.down);
  await h.advance(CUTTING);
  captureStill(h, "audio");
  h.release(ACTION_KEY.down);

  assertEqual(faults.join(", "), "", "specs/assets.md");
});
