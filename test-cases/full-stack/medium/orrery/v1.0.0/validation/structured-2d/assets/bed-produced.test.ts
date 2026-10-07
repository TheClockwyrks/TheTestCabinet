// assets/bed-produced — the music bed ships at its named path.
//
// THE RULE, from The music bed of `specs/assets.md`: "Produce the `music` cue
// with `music`, which may sequence the baked instrument bank, synth waveforms, or
// both: `assets/audio/music.wav`, with its `assets/audio/music.mid` committed
// beside it. The `.wav` is what the game plays". Where the files land roots the
// path: "Every produced file sits under `assets/` at the root of this repository,
// at the path named below, and is committed."
//
// WHY THE NAME IS THE WHOLE POINT. `CUE_PATHS` carries the bed's path beside the
// six one-shot cues', and the build asks its loader for exactly that path, so a
// bed committed under a name of the build's own choosing is a bed the game cannot
// reach. `specs/ui.md` then runs it under every screen the game shows, so a bed
// that is not there is a game that plays under silence.
//
// WHAT THIS POINT DOES NOT READ. Whether the file decodes as a WAV, whether it
// carries signal, how long it runs, whether it loops cleanly, and whether its
// score is committed beside it are the five points after this one. This one reads
// that a file is there, at that path.
//
// THE EVIDENCE is the bed itself as a waveform, with the length, rate and channel
// count read off its container — or the reason it could not be read, where the
// build committed nothing.

import { it } from "vitest";
import { assertNotNull } from "../assert";
import { readClip, showClips } from "./clips";
import { BED_FILE } from "./files";
import { soundBytes } from "./sounds";

it("commits the music bed at assets/audio/music.wav", () => {
  showClips("bed", [readClip("music bed", BED_FILE)]);

  assertNotNull(soundBytes(BED_FILE), `the produced music bed at ${BED_FILE}`);
});
