// Arc Foundry — audio/cue-files-distinct: the eleven effect cues are eleven
// different sounds.
//
// THE REQUIREMENT, from `specs/assets.md`: "The eleven effect cues are told apart by
// ear", and from `specs/ui.md`: "Each of the eleven effect cues is a distinct
// sound, so the events are told apart by ear." The music bed is the twelfth cue and
// is not one of the eleven; it is left out here for the same reason the
// specification leaves it out of that sentence.
//
// WHY THIS POINT MATTERS MORE HERE THAN UNDER AN ENGINE. The name of a sound is not
// observable from outside an engineless build, so the twelve event points can say
// that a cue sounded on the right frame and cannot say which cue it was. What makes
// the reviewer's job possible instead is that the eleven files are eleven different
// sounds: a build that committed one blip eleven times passes every event point and
// is still impossible to read by ear, and this is the point that catches it.
//
// COMPARED AS SAMPLES, NOT AS BYTES. Each file is decoded to PCM and the samples
// compared, so two encodings of one sound read as one sound. What is asked is that
// the sounds differ at all — a single sample is enough. How DIFFERENT they are, and
// whether a player can name the event from the sound, is the aesthetic rating's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { CUES } from "../constants";
import {
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  type Harness,
} from "../harness";
import { ANCHOR, TARGET, evidence } from "./cues";
import { fileOf, identical, readWave } from "./wav";

/** The eleven `specs/ui.md` asks to be told apart: every cue but the music bed. */
const EFFECT_CUES = CUES.filter((cue) => cue !== "music");

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("renders eleven different sounds for the eleven effect cues", async () => {
  await evidence(h, "run", async () => {
    await openYard(h, { wave: 1 });
    await standComponent(h, "coil", 1, ANCHOR.col, ANCHOR.row);
    await parkUnit(h, "mote", TARGET, { hp: 1 });
    await h.advanceSeconds(2);
  });

  const waves = EFFECT_CUES.map((cue) => readWave(fileOf(cue)));
  const repeated: string[] = [];
  for (let i = 0; i < waves.length; i += 1) {
    for (let j = i + 1; j < waves.length; j += 1) {
      if (identical(waves[i]!, waves[j]!)) {
        repeated.push(`${waves[i]!.at} and ${waves[j]!.at}`);
      }
    }
  }
  assertDeepEqual(
    repeated,
    [],
    "no two of the eleven effect cues to be the same audio, so the events are " +
      "told apart by ear (specs/ui.md)",
  );
});
