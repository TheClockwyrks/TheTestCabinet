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
//   specs/state.md: `muted` is "the game's readable copy of the engine's mute
//   bit", and specs/instrumentation.md has `snapshot()` report it, refreshed
//   "from the runtime in every update".
//   specs/state.md ("The title state"): `muted` is `false` on a fresh game, which
//   is the precondition read back before the press.
//
// THE DRIVE. The run is opened through the debug surface rather than through the
// title's confirm key, so a broken title fails the title points alone. The bit
// is read back before the press, so a build that opened already muted fails here
// rather than passing on a bit that never moved. `pressMute` is a REAL `KeyM`
// dispatched at the engine's own input seam, so the registered action, the game's
// reading of it and the bus it drives are all on the path.
//
// WHAT IS NOT ASSERTED, AND WHY. That the speakers went quiet. specs/ui.md leaves
// the runtime free to mute either by silencing its sources or by holding them at
// zero gain — "A muted bed goes on looping silently" — and the engine's own bus
// keeps announcing a muted cue at `gain: 0`, so a count of live sources cannot
// decide this and would fail a conformant build for choosing either way. The
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
  captureStill(h, "muted");

  assertEqual(muted.muted, true, "the mute bit after KeyM");
});
