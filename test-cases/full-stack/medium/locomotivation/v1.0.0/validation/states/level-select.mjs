// State: the level-select / campaign screen is reachable from the title (PLAY).

export default function item() {
  // The screen PLAY reached.
  let screen;

  return {
    id: "states.level-select",

    // Land on the title. `reset` is arrange-only.
    async arrange(api) {
      await api.reset();
    },

    // Choosing PLAY, on camera, then a paint settle so the level-select screen has been
    // drawn before it is read and captured.
    async act(api) {
      await api.call("press", "Enter"); // PLAY

      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("state");
    },

    async assert(api, check) {
      check.expectEq(
        "PLAY reaches the level-select screen",
        screen,
        "level-select",
      );
    },
  };
}
