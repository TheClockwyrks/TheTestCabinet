// Automated validation for the Presentation sub-item `state-howto`: the how-to-play
// screen is reachable, and the debug API captures it. From the title, a real click
// (injected pointer input) on the HOW TO PLAY menu item opens the how-to screen; the
// screen is read back and captured. Whether it reads well is judged by eye.
//
// The reset to the title is the precondition (`arrange`); the click that opens the
// how-to screen is the behavior under test, so it is what `act` films. The pause
// before the capture is `api.settle`, not `api.advance`: a screenshot must read a
// PAINTED frame, and stepping the simulation produces none. `settle` is real
// milliseconds in both passes, so the 120 ms carries over unconverted.

export default function item() {
  // The screen the click opened.
  let screen;

  return {
    id: "ui.state-howto",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      // Click the second title-menu item (HOW TO PLAY), centered on the stage.
      await api.call("click", 640, 534);
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq(
        "clicking HOW TO PLAY opens the how-to screen",
        screen,
        "howto",
      );
    },
  };
}
