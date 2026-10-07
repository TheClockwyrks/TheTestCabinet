// assets/cues-bound-to-their-files — each cue name plays the produced file of
// its own name.
//
// WHAT THIS DECIDES. Fifteen bindings: with the build initialized, each of
// `hit`, `kill`, `gem`, `hurt`, `level-up`, `choose`, `chest`, `evolve`,
// `pickup`, `fallen`, `dawn`, `menu-move`, `menu-confirm`, `hum` and `music`
// is sounded through the engine's own bus, and the sound that starts is
// decoded from `assets/audio/<that name>.wav`. A name bound to nothing, bound
// to a synthesized shape, or bound to another cue's file is named in the
// failure.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Where the files land, and
// how they are loaded"): "each audio cue below is bound to its produced file
// with `api.audio.load` under its name in `CUES`", and ("The sound") "Bind
// each name in `CUES` to its file through the engine's `audio.load`, play a
// cue on its event, and run the two loops through the world's `audio.loop`
// and `audio.stop`." The tables under "The sound" and "The music bed" give
// every name its file, and `CUE_PATHS` in `src/constants.ts` carries the same
// pairing.
//
// WHY THE BUS IS DRIVEN DIRECTLY. The binding is what this point is about,
// and a binding is only observable when the name sounds: the engine's bus
// resolves the name to whatever the build loaded under it, so `play` and
// `loop` on the open world read the build's own binding and nothing else. No
// game event is used to reach a cue, because a build with a broken kill and a
// correct binding must fail the kill point and pass this one — which event
// sounds which cue is the audio category's business. The two looping cues are
// looped rather than played, as `specs/assets.md` says they are run, and
// stopped again so nothing is left sounding.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each file exists and carries
// signal is `assets/cue-files-produced` and `assets/music-produced`; that the
// binding is in place before the first frame is
// `assets/assets-decoded-before-first-frame`.
//
// THE TOLERANCE. None: the file a sound was decoded from is a name, and it
// either is the cue's own file or is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUE_NAMES, LOOPING_CUES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { showLines } from "./produced";
import { cueFile } from "./sounds";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays every cue from the produced file of its own name", () => {
  /** What each cue's name sounded, in cue order: its file, or why not. */
  const sounded = CUE_NAMES.map((cue) => {
    const before = h.cues.length;
    if (LOOPING_CUES.includes(cue)) {
      h.world.audio.loop(cue);
      h.world.audio.stop(cue);
    } else {
      h.world.audio.play(cue);
    }
    const started = h.cues.slice(before);
    if (started.length === 0) return { cue, from: "the cue never sounded" };
    return { cue, from: started[0].file ?? "no sound started" };
  });
  showLines(
    h,
    sounded.map((one) => `${one.cue} — ${one.from}`),
  );
  captureStill(h, "bound");

  for (const one of sounded) {
    assertEqual(
      one.from,
      cueFile(one.cue),
      `the produced file the ${one.cue} cue sounded from`,
    );
  }
});
