// Automated validation for the Controls item `mute`.
//
// Pressing M toggles mute. From the title (mute off) a single injected M press
// flips `muted` on, and a title screenshot captures the changed state. See
// validation/_helpers.mjs.

export default function item() {
  // Mute before the press (read instantly in `arrange`, since the press flips it) and
  // after it.
  let mutedBefore;
  let mutedAfter;

  return {
    id: "controls.mute",

    // Back to the title, where mute starts off.
    async arrange(api) {
      await api.reset();
      mutedBefore = (await api.snapshot()).muted;
    },

    // The press and the title redrawing with the changed mute state — what the
    // screenshot captures.
    async act(api) {
      await api.call("press", "KeyM");
      mutedAfter = (await api.snapshot()).muted;
      await api.advance(24); // 0.2 s, so the title redraws with the mute state
      await api.screenshot("title");
    },

    async assert(api, check) {
      check.expectEq("mute starts off", mutedBefore, false);
      check.expectEq("pressing M toggles mute on", mutedAfter, true);
    },
  };
}
