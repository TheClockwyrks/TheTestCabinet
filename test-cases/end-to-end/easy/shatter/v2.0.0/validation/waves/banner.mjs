// Automated validation for the Waves item `banner`: a brief WAVE N banner shows at the
// start of each wave. A real game is started and the field cleared; stepping a moment
// raises the next wave's banner, which the snapshot reports and a screenshot captures.
//
// Starting the game and emptying the field are instant (`arrange`); the moment of simulation
// that notices the empty field and raises the banner is the behavior (`act`), so the clip shows
// the banner actually appearing. 0.1 s x 120 Hz = 12 ticks.
//
// The pause before the capture is `api.settle`, not `api.advance`: the banner has to have been
// PAINTED for the screenshot to show it, and advancing further would risk stepping past it.

export default function item() {
  // The state with the banner up, read by `assert`.
  let snap;

  return {
    id: "waves.banner",

    async arrange(api) {
      await api.reset({ seed: 3 });
      await api.call("startGame");
      await api.call("setInvuln", 99); // seconds — keep the ship alive through the measurement
      await api.call("clearRocks");
    },

    async act(api) {
      await api.advance(12); // the cleared field advances the wave and raises its banner
      snap = await api.snapshot();

      await api.settle(140); // let a frame paint the banner
      await api.screenshot("banner");
    },

    async assert(api, check) {
      check.expectOk(
        "the WAVE banner is showing at the start of the new wave",
        snap.waveBanner === true,
      );
      check.expectEq("the banner is for the new wave (wave 2)", snap.wave, 2);
    },
  };
}
