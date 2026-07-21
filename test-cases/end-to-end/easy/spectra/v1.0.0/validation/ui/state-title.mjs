// Automated validation for the UI sub-item `state-title`: the title / main menu is
// reachable, and the debug API captures it so a reviewer sees the actual menu.
//
// A reset returns the game to its initial title state; the screen is read back and a
// screenshot captured. Whether the menu reads and lays out well is judged by eye.

export default function item() {
  // The screen the reset landed on.
  let screen;

  return {
    id: "ui.state-title",

    // A reset returns the game to its initial state, which is the title.
    async arrange(api) {
      await api.reset();
    },

    // Nothing to drive — the title is already on screen. The only thing `act` needs
    // is a painted frame for the capture, which `settle` (a real pause in both
    // passes) guarantees; instant stepping paints nothing at all.
    async act(api) {
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("title");
    },

    async assert(api, check) {
      check.expectEq("the title is the initial screen", screen, "title");
    },
  };
}
