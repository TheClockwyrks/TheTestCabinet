// Automated validation for the Lives item `starts-three`: a new game starts with 3 ships.
// A real game is started (through the same path PLAY takes) and the life count read back;
// the fresh HUD is captured.
//
// Starting the game is the precondition (`arrange`). `act` reads the fresh state and captures
// the HUD; the pause before the capture is `api.settle` rather than `api.advance` because the
// HUD has to have been PAINTED for the screenshot to show it, and stepping the simulation
// produces no frame at all in the validate pass.

export default function item() {
  // The state of the freshly started game, read by `assert`.
  let snap;

  return {
    id: "lives.starts-three",

    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("startGame");
    },

    async act(api) {
      snap = await api.snapshot();
      await api.settle(140); // let a frame paint the fresh HUD
      await api.screenshot("lives");
    },

    async assert(api, check) {
      check.expectEq("a new game starts with 3 ships", snap.lives, 3);
      check.expectEq("the new game is in play", snap.screen, "playing");
    },
  };
}
