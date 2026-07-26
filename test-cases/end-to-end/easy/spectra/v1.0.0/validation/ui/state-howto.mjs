// Automated validation for the UI sub-item `state-howto`: the how-to-play screen is
// reachable, and captured for the reviewer.
//
// From the title, the menu is navigated to HOW TO PLAY (the second entry) with
// injected keys and confirmed; the resulting screen is read back and captured.

export default function item() {
  // The screen the navigation landed on.
  let screen;

  return {
    id: "ui.state-howto",

    // The title screen, freshly reset, with the menu on its first entry.
    async arrange(api) {
      await api.reset();
    },

    // Menu navigation is instant, so nothing here consumes simulation time — but the
    // capture still needs a painted frame, which only `settle` (a real pause in both
    // passes) provides.
    async act(api) {
      await api.call("press", "ArrowDown"); // move to HOW TO PLAY
      await api.call("press", "Enter"); // confirm
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq("the how-to-play screen is reachable", screen, "howto");
    },
  };
}
