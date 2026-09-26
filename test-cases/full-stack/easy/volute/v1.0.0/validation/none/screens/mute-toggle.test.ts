// screens/mute-toggle — M mutes the hall.
//
// WHAT THIS DECIDES. One thing: the mute control, pressed during play, leaves
// the game reporting itself muted. A second press, which returns the sound, is
// deliberately not this point's business.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "mute | `KeyM` | — | edge |
//   toggles the audio between muted and unmuted", and "Mute answers on every
//   screen."
//   specs/ui.md ("Mute"): "The game binds the mute action to the runtime's mute
//   bit and toggles it from any screen."
//   specs/instrumentation.md: "`muted` mirrors the runtime's mute bit. Refresh it
//   from the runtime in every update", which is what `snapshot()` reports.
//   specs/state.md: "A fresh game starts with its audio unmuted", which is the
//   precondition read back before the press.
//
// THE DRIVE. The run is opened through the debug surface rather than through the
// title's confirm key, so a broken title fails the title points alone. The bit
// is read back before the press, so a build that opened already muted fails here
// rather than passing on a bit that never moved. `pressMute` is a REAL `KeyM`
// through Chromium's input pipeline: the build wrote the keyboard layer, the
// audio layer and the mirror between them, and this drives all three.
//
// WHAT IS NOT ASSERTED, AND WHY. That the speakers went quiet. There is no cue
// bus to ask under this engine, and specs/ui.md leaves the runtime free to mute
// either by silencing its sources or by holding them at zero gain — "Muting
// silences every cue and the running bed without stopping the bed" — so a count
// of live audio sources cannot decide
// this and would fail a conformant build for choosing the other way. The
// specification fixes the REPORTED bit, so the reported bit is what this reads;
// whether the hall actually fell silent is the reviewer's, by ear.
//
// THE TOLERANCE. None: a boolean is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressMute,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the hall muted after M is pressed in play", async () => {
  await startRun(h);
  const live = await h.step(1);
  assertEqual(live.screen, "playing", "the screen the press is made from");
  assertEqual(live.muted, false, "the mute bit before the press");

  const muted = await pressMute(h);
  await captureStill(h, "muted");

  assertEqual(muted.muted, true, "the mute bit after KeyM");
});
