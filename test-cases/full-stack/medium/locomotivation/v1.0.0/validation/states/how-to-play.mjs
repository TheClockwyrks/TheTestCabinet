// State: the how-to-play screen is reachable from the title (HOW TO PLAY).

export default function item() {
  // The screen the menu navigation reached.
  let screen;

  return {
    id: "states.how-to-play",

    // Land on the title. `reset` is arrange-only — it hands the build back its manual
    // clock, which mid-act would silently freeze the recording.
    async arrange(api) {
      await api.reset();
    },

    // The navigation itself, on camera, then a paint settle so the how-to screen has
    // actually been drawn before it is read and captured. `settle` rather than `advance`
    // because this waits for a FRAME, which instant stepping never produces.
    async act(api) {
      await api.call("press", "ArrowDown"); // move to HOW TO PLAY
      await api.call("press", "Enter");

      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("state");
    },

    async assert(api, check) {
      check.expectEq(
        "HOW TO PLAY reaches the how-to-play screen",
        screen,
        "how-to-play",
      );
    },
  };
}
