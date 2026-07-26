// Automated validation for the Audio sub-item `mute-toggle`.
//
// The mute key (M) toggles mute. From the title (mute off) a single M press flips
// the muted flag on, read back from snapshot(); a title screenshot captures the
// changed mute state for the reviewer.

export default function item() {
  // The muted flag before the press (read while arranging) and after it.
  let before;
  let after;

  return {
    id: "audio.mute-toggle",

    // The title screen, freshly reset, where mute starts off.
    async arrange(api) {
      await api.reset();
      before = (await api.snapshot()).muted;
    },

    // The press itself is instant, so the only thing filmed is the title with mute
    // now on. The settle is a real pause in both passes: the capture must read a
    // frame painted AFTER the toggle, which no amount of instant stepping produces.
    async act(api) {
      await api.call("press", "KeyM");
      after = (await api.snapshot()).muted;
      await api.settle(120);
      await api.screenshot("mute");
    },

    async assert(api, check) {
      check.expectOk("mute starts off", before === false);
      check.expectOk("pressing M toggles mute on", after === true);
    },
  };
}
