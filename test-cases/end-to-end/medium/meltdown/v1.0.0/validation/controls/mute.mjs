// Automated validation for the Controls sub-item `mute`.
//
// The mute hotkey toggles sound (specs/controls.md, specs/ui.md). From a running match
// with mute off, a single press flips it on — and a second press flips it back, so what
// is checked is a toggle and not a one-way switch.
//
// Tested in a match, not on the title screen. The mute toggle the spec requires is a
// HUD control in the build panel (specs/ui.md), which exists while a match is running,
// and injected input triggers "any one-shot action the key triggers ON THE CURRENT
// SCREEN" (specs/instrumentation.md) — so a build that scopes its accelerators to the
// screens that own them is conformant, and pressing mute at the title proves nothing
// either way. Note the key itself is the build's own choice ("a key (for example `M`)",
// with the chosen keys listed in the How to play screen and the produced README.md);
// `KeyM` is the spec's example and the code `specs/instrumentation.md` names, so it is
// what this drives.
//
// A CLIP, AND WHY THAT NOW MEANS SOMETHING.
//
// `muted` is a snapshot field, so the mechanical half of this item was always decidable
// — but a still of a muted game was worthless as evidence, because a recorded clip
// carries no audio track and nothing on screen had to change. `specs/ui.md` now requires
// the mute control to show which state it is in ("a struck-through or otherwise
// distinctly drawn icon, a label that changes, a lit/unlit button"), which gives the
// media something real to depict: the control before the press, the control after it,
// and the control back again. Held long enough on each that a reviewer can compare the
// three, that is a check on the on-screen half that no snapshot field can make.

import { newGame, press, actTail } from "../_helpers.mjs";

// The beat held in each state, so the mute control is legible before and after each
// press. 90 ticks is 1.5 s.
const HOLD = 90;

export default function item() {
  let before;
  let on;
  let off;

  return {
    id: "controls.mute",

    clipMs: 8000,

    // A running match, where mute starts off and the HUD's mute control is on screen.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // Off, on, off — each held long enough to read.
    async act(api) {
      before = (await api.snapshot()).muted;
      await actTail(api, HOLD); // the un-muted control, before anything is pressed

      await press(api, "KeyM");
      on = (await api.snapshot()).muted;
      await actTail(api, HOLD); // the muted control

      await press(api, "KeyM");
      off = (await api.snapshot()).muted;
      await actTail(api, HOLD); // and back to un-muted
    },

    async assert(api, check) {
      check.expectEq("mute starts off", before, false);
      check.expectEq("M toggles mute on", on, true);
      check.expectEq("and a second press toggles it back off", off, false);
    },
  };
}
