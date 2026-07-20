// Automated validation for the UI item `state-title`: the title / main menu is reachable,
// captured so a reviewer sees the actual menu. A reset returns the game to its initial
// title state; the screen is read back and a screenshot captured. Whether the menu is laid
// out well is judged by eye from the capture.
//
// The reset is the precondition (`arrange`). The output is only a still, but `act` still has to
// be the meaningful part: it holds long enough for the title to paint and then takes the
// capture (which produces media in the record pass only). That hold is `api.settle`, not
// `api.advance` — a capture needs a PAINTED frame, and stepping the simulation produces none.

export default function item() {
  // The screen the reset landed on, read by `assert`.
  let screen;

  return {
    id: "ui.state-title",

    async arrange(api) {
      await api.reset({ seed: 1 });
    },

    async act(api) {
      await api.settle(140); // let a frame paint the title
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
