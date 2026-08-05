// Automated validation for the Controls item `mute`.
//
// Pressing M toggles mute on, and pressing it again toggles it back off. Both are
// driven with real injected input during a live crossing, and the in-game screen is
// captured with mute on. See validation/_helpers.mjs.
//
// IN GAME, NOT ON THE TITLE. The mute toggle is specified as a control of the game's
// audio — specs/ui.md requires the cues and asks for a toggle so the game "stays
// fully playable with sound muted", and specs/controls.md lists M among the controls
// without tying it to a screen. Nothing in either file says the toggle must answer on
// the title screen, and the title has no cue to silence: a build that binds M
// wherever sound is actually produced (play, the pause menu, and the end screens)
// meets every word of the specification, and one audited against this case shipped
// exactly that. Driving the press from the title decided this item on a screen the
// specification never mentions, and failed a build whose mute works everywhere a
// player would reach for it. The press is driven where the requirement bites
// instead: mid-crossing, with the game making noise.
//
// AND IT IS DRIVEN BOTH WAYS. The item is that M TOGGLES mute — "on and off". One
// press only shows that a key sets a flag; pressing again is what tells a toggle from
// a one-way switch, and it costs one more press.

import { startCrossing, ICE_TOP } from "../_helpers.mjs";

// The column the crossing is posed on, and the beat after each press — long enough
// for the game to redraw with the changed state, and for the clip to read.
const COL = 20;
const SETTLE_TICKS = 36; // 0.3 s

export default function item() {
  // Mute before the first press, after it, and after the second one.
  let mutedBefore;
  let mutedOn;
  let mutedOff;

  return {
    id: "controls.mute",

    // A live crossing on cleared ice: where audio plays, and where the toggle has to
    // answer. The tile is hazard-free and the bear is off the board, so nothing can
    // end the crossing between the two presses.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setBear", 0, null);
      await api.call("setLane", ICE_TOP, { cols: [] });
      await api.call("placeCritter", COL, ICE_TOP);
      mutedBefore = (await api.snapshot()).muted;
    },

    // Mute on, held long enough to be seen and captured, then mute back off — the
    // toggle, and the whole of the clip.
    async act(api) {
      await api.call("press", "KeyM");
      mutedOn = (await api.snapshot()).muted;
      await api.advance(SETTLE_TICKS); // so the game redraws with the mute state
      await api.screenshot("game");

      await api.call("press", "KeyM");
      mutedOff = (await api.snapshot()).muted;
      await api.advance(SETTLE_TICKS);
    },

    async assert(api, check) {
      check.expectEq("mute starts off", mutedBefore, false);
      check.expectEq("pressing M toggles mute on", mutedOn, true);
      check.expectEq("pressing M again toggles it back off", mutedOff, false);
    },
  };
}
