// controls.mute: M toggles the mute flag (captured at the title).
//
// The reset to the title is instant (`arrange`); the keypress and the settle the capture
// needs are `act`, so the clip and the still both show the toggle actually being made.

export default function item() {
  let before;
  let after;

  return {
    id: "controls.mute",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      before = (await api.snapshot()).muted;
      await api.call("press", "KeyM");
      after = (await api.snapshot()).muted;
      // A REAL pause (the old wait(150)) so the toggled title has been painted before
      // the still is captured — an instant advance produces no frame.
      await api.settle(150);
      await api.screenshot("mute");
    },

    async assert(api, check) {
      check.expectEq("mute starts off at the title", before, false);
      check.expectEq("pressing M toggles mute on", after, true);
    },
  };
}
