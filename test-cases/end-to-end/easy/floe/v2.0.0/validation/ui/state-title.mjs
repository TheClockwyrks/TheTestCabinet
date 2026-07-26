// Automated validation for the UI item `state-title`: the title / main menu is
// reachable, and the debug API captures it so a reviewer sees the actual screen.
// The auto-verdict confirms the state is reachable; the layout is left to the reviewer.

export default function item() {
  // The screen the reset landed on.
  let screen;

  return {
    id: "ui.state-title",

    async arrange(api) {
      await api.reset();
    },

    // Nothing has to happen for the check; the clip's job is to show the title screen
    // the capture is proof of, so let it draw, read it, and capture it.
    async act(api) {
      // 0.12 s is 14.4 ticks, which the tick contract rejects rather than rounds. This
      // is a paint settle, so it rounds UP to 15 — never shorter than it was.
      await api.advance(15);
      screen = (await api.snapshot()).screen;
      await api.screenshot("title");
    },

    async assert(api, check) {
      check.expectEq("reset returns to the title screen", screen, "title");
    },
  };
}
