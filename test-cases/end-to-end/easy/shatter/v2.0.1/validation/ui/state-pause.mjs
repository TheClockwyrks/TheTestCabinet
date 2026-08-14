// Automated validation for the UI item `state-pause`: the pause screen is reachable,
// captured for review. A real game is started and paused; the pause state is read back and
// the pause menu captured (offering resume, restart, and quit).
//
// Starting the game and pausing it are instant key/control ops, so they are `arrange`. `act`
// holds long enough for the pause menu to paint and takes the capture — with `api.settle`, not
// `api.advance`, because a capture needs a PAINTED frame and stepping the simulation produces
// none (and a paused game would not advance anyway).

export default function item() {
  // The screen the pause landed on, read by `assert`.
  let screen;

  return {
    id: "ui.state-pause",

    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("startGame");
      await api.call("press", "Escape");
    },

    async act(api) {
      await api.settle(140);
      screen = (await api.snapshot()).screen;
      await api.screenshot("pause");
    },

    async assert(api, check) {
      check.expectEq(
        "pausing a live game reaches the pause screen",
        screen,
        "paused",
      );
    },
  };
}
