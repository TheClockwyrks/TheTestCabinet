// Arc Foundry — audio/cue-files-present: the twelve cue files are produced, decode
// as PCM, and carry a sound.
//
// THE REQUIREMENT, from `specs/assets.md`: "Produce twelve `.wav` files, one per
// cue in `specs/ui.md`, at `assets/audio/<cue>.wav`. `music` also emits a `.mid`
// score beside its `.wav`; commit it at `assets/audio/music.mid` and play the
// `.wav`." `specs/ui.md` fixes the twelve names.
//
// WHAT IS ASSERTED. That each of the twelve `.wav` files is on disk, decodes as PCM
// audio, and carries at least one sample that is not silence; and that
// `music.mid` is committed beside the music cue's own file. A cue bound to a file
// of zeros is a cue nobody hears, which is the same miss as a cue bound to
// nothing — and it is a different miss from a cue the game never asks for, which
// is what the twelve event points decide.
//
// THE FLOOR IS SILENCE ITSELF, not a loudness. `specs/assets.md` says what each cue
// IS — "a sharp single zap", "a short, light spark, played often" — and fixes no
// amplitude for any of them, so how loud a build renders its cues is the build's
// and only a file with nothing in it at all fails here.
//
// THE `.mid` IS CHECKED FOR PRESENCE ALONE. The specification commits it beside the
// bed and plays the `.wav`, so what it asks of the score is that it was kept.
//
// THE FILES ARE READ OFF DISK, never through the engine's loader: decoding audio
// needs a Web Audio context and this host has none, so what a build committed is
// read directly and the point is decided by the bytes.

import { existsSync } from "node:fs";

import { afterEach, beforeEach, it } from "vitest";

import { CUES } from "../../src/constants";
import { assertDeepEqual } from "../assert";
import {
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  type Harness,
} from "../harness";
import { ANCHOR, TARGET, evidence } from "./cues";
import { ASSETS, fileOf, peak, present, readWave } from "./wav";

/** The twelve cue names `specs/ui.md` fixes, as the paths they are produced at. */
const NAMES = Object.values(CUES);

/** The score `specs/assets.md` commits beside the music cue's own file. */
const SCORE = "audio/music.mid";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("produces twelve cue files that decode and carry a sound", async () => {
  await evidence(h, "run", async () => {
    openYard(h, { wave: 1 });
    standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
    parkUnit(h, "mote", TARGET, { hp: 1 });
    await h.advanceSeconds(2);
  });

  const gone = [...NAMES.map(fileOf), SCORE].filter(
    (at) => !(at === SCORE ? existsSync(ASSETS + SCORE) : present(at)),
  );
  assertDeepEqual(
    gone,
    [],
    "assets/audio/<cue>.wav on disk for all twelve cue names, and " +
      "assets/audio/music.mid beside the music cue's own file " +
      "(specs/assets.md)",
  );

  const silent = NAMES.filter((cue) => peak(readWave(fileOf(cue))) === 0).map(
    fileOf,
  );
  assertDeepEqual(
    silent,
    [],
    "each produced cue to carry a sample that is not silence (specs/assets.md)",
  );
});
