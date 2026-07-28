// Automated validation for controls.mute-m: pressing M toggles the game's mute state.
// Injected input flows through the real key handling (audio.toggleMute), and the
// muted flag flips.

export default function item() {
  let before;
  let after;

  return {
    id: "controls.mute-m",

    // Mute is a global toggle, so the flag flips from any screen — but the still is
    // the point of this item, and a build shows its mute state on the in-game HUD,
    // not on its title menu. `enterPlay` (specs/instrumentation.md: no control
    // operation starts a run on its own) is what puts the still inside a live game
    // rather than on the main menu, and `setLevel` gives that board its worm.
    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("enterPlay");
      await api.call("setLevel", 1);
    },

    // The press lives here rather than in `arrange` so the recording actually shows
    // the toggle happening: an arranged press would already have flipped the flag
    // before the record pass started filming. Both reads are instant, so the verdict
    // is the same either way.
    async act(api) {
      // A beat of live play first, so the still is of a game in motion — the worm
      // winding on from the top edge — rather than the bare board `enterPlay` lays.
      // The worm is nineteen rows above the band at level 1's cadence, so nothing
      // can reach the cursor in that time and the mute reads below are unaffected.
      await api.advance(180); // 1.5s
      before = (await api.snapshot()).muted;
      await api.call("press", "KeyM");
      after = (await api.snapshot()).muted;
      await api.settle(150); // a real pause so the muted HUD state has painted
      await api.screenshot("mute");
    },

    async assert(api, check) {
      check.expectEq("mute starts off", before, false);
      check.expectEq("pressing M toggles mute on", after, true);
    },
  };
}
