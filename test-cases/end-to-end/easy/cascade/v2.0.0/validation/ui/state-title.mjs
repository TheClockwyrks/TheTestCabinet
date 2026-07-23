// Automated validation for the Presentation sub-item `state-title`: the title / main
// menu is reachable, and the debug API captures it so a reviewer sees the actual
// menu. A reset returns the game to its initial title state; the screen is read back
// and captured. Whether the menu reads and lays out well is left to the reviewer from
// the capture.
//
// The reset is the precondition (`arrange`, the only phase that may reset). The pause
// before the capture is `api.settle`, not `api.advance`: a screenshot must read a
// PAINTED frame, and stepping the simulation produces none. `settle` is real
// milliseconds in both passes, so the 120 ms carries over unconverted.

export default function item() {
  // The screen the capture was taken of.
  let screen;

  return {
    id: "ui.state-title",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("title");
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
