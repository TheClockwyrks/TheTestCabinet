// Controls: M toggles the mute flag. From the title (mute off) a single M press flips it
// on; a title screenshot captures the changed mute hint.

export default function item() {
  // The mute flag either side of the press.
  let mutedBefore;
  let mutedAfter;

  return {
    id: "controls.mute",

    // Land on the title with mute in its default state, and read that default. Both are
    // instant, so they belong here rather than in the timed phase.
    async arrange(api) {
      await api.reset();
      mutedBefore = (await api.snapshot()).muted;
    },

    // The toggle itself, then a paint settle so the changed mute hint has actually been
    // drawn before the capture. `settle` rather than `advance` because this waits for a
    // FRAME, which no amount of instant stepping produces.
    async act(api) {
      await api.call("press", "KeyM");
      mutedAfter = (await api.snapshot()).muted;

      await api.settle(150);
      await api.screenshot("shot");
    },

    async assert(api, check) {
      check.expectEq("mute starts off at the title", mutedBefore, false);
      check.expectEq("pressing M toggles mute on", mutedAfter, true);
    },
  };
}
