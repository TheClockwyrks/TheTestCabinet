// Automated validation for the UI sub-item `state-stage-intro`: the stage-intro
// screen (shown before a wave begins) is reachable, and captured for the reviewer.
//
// From the title, LAUNCH is confirmed with injected keys, which begins the first
// stage — landing on the stage-intro hold. The screen is read back (without
// advancing, so the timed hold does not elapse) and captured.

export default function item() {
  // The screen confirming LAUNCH landed on.
  let screen;

  return {
    id: "ui.state-stage-intro",

    // The title screen, freshly reset, with LAUNCH selected as the first menu entry.
    async arrange(api) {
      await api.reset();
    },

    // Deliberately no `advance`: the stage intro is a TIMED hold, so advancing the
    // simulation would run it out and land on the wave instead of the screen this
    // item is about. `settle` pauses in real time to let the frame paint without
    // moving the game — which is exactly the distinction it exists for.
    async act(api) {
      await api.call("press", "Enter"); // confirm LAUNCH (the first menu entry)
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("intro");
    },

    async assert(api, check) {
      check.expectEq(
        "starting the mode lands on the stage intro",
        screen,
        "stageIntro",
      );
    },
  };
}
