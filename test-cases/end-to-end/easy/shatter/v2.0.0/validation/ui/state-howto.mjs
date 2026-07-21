// Automated validation for the UI item `state-howto`: the how-to-play screen is reachable,
// captured for review. From the title, the menu is navigated to How to Play and confirmed;
// the screen is read back and captured.
//
// The menu navigation is nothing but single key presses, which are instant, so all of it is
// `arrange`. `act` holds long enough for the how-to screen to paint and takes the capture —
// with `api.settle`, not `api.advance`, because a capture needs a PAINTED frame and stepping the
// simulation produces none.

export default function item() {
  // The screen the navigation landed on, read by `assert`.
  let screen;

  return {
    id: "ui.state-howto",

    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("press", "ArrowDown"); // highlight HOW TO PLAY
      await api.call("press", "Enter");
    },

    async act(api) {
      await api.settle(140);
      screen = (await api.snapshot()).screen;
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq(
        "How to Play is reachable from the title",
        screen,
        "howto",
      );
    },
  };
}
