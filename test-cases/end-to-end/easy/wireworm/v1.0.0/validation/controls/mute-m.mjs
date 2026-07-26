// Automated validation for controls.mute-m: pressing M toggles the game's mute state.
// Injected input flows through the real key handling (audio.toggleMute), and the
// muted flag flips.

export default function item() {
  let before;
  let after;

  return {
    id: "controls.mute-m",

    async arrange(api) {
      await api.reset({ seed: 1 });
    },

    // The press lives here rather than in `arrange` so the recording actually shows
    // the toggle happening: an arranged press would already have flipped the flag
    // before the record pass started filming. Both reads are instant, so the verdict
    // is the same either way.
    async act(api) {
      before = (await api.snapshot()).muted;
      await api.call("press", "KeyM");
      after = (await api.snapshot()).muted;
      await api.settle(150); // a real pause so the muted HUD state has painted
      await api.screenshot("mute");
    },

    async assert(api, check) {
      check.expectEq("mute starts off", before, false);
      check.expectEq("pressing M toggles mute on", after, true);
    },
  };
}
