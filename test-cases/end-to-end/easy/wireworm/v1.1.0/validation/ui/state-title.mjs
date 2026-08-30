// Automated validation for ui.state-title: the title / main menu is reachable, and
// the debug API captures it so a reviewer sees the actual menu. Whether it is laid
// out well is left to the reviewer from the capture.

export default function item() {
  let screen;

  return {
    id: "ui.state-title",

    async arrange(api) {
      await api.reset({ seed: 1 });
    },

    // Nothing to drive — the title is the initial screen. `act` still holds on it so
    // the recording is the menu itself, and settles first so it has painted before
    // the still is captured.
    async act(api) {
      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("title");
      await api.advance(120); // 1s holding on the menu, so the clip is watchable
    },

    async assert(api, check) {
      check.expectEq(
        "the title / main menu is the initial screen",
        screen,
        "title",
      );
    },
  };
}
