// Automated validation for the Lives item `starts-three`: a new game starts with 3 ships.
// A real game is started (through the same path PLAY takes), the fresh HUD is captured, and
// then the game is made to prove the count: ships are lost one at a time, and the run must
// survive the first two losses and end on the third.
//
// Both halves are checked, because the case now fixes both.
//
// The mechanical fact — three ships means three losses — is what the drive proves, and it is
// the half that cannot be faked: a build that merely reports the right number while ending the
// run after two deaths, or carrying on after four, fails here whatever its HUD says.
//
// The REPORTED number is checked exactly, at 3, which it was not always. The case used to
// leave the counting convention open: `specs/gameplay.md` said a game starts with 3 ships
// while `specs/instrumentation.md` called the snapshot field "ships in reserve", so a build
// that launched three ships and reported `lives: 2` — the two waiting behind the one being
// flown — satisfied both sentences, and so did one reporting `3`. This check accepted either,
// which meant two builds could disagree by a whole ship and both pass, and the HUD glyph count
// had nothing to be right or wrong against. The specs now settle it (see `lives` under
// Snapshot shape in `specs/instrumentation.md`): `lives` is the total still left INCLUDING the
// ship in play, so a fresh game reports 3, and the HUD's reserve row is `lives - 1`. With the
// convention fixed, the number is a real assertion again.
//
// Starting the game is the precondition (`arrange`); reading the fresh state, capturing the
// HUD and then spending the three ships are `act`. The pause before the capture is
// `api.settle` rather than `api.advance` because the HUD has to have been PAINTED for the
// screenshot to show it, and stepping the simulation produces no frame at all in the validate
// pass.

import { actLoseEveryShip } from "../_helpers.mjs";

export default function item() {
  // The state of the freshly started game, and what spending its ships did.
  let snap;
  let run;

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

      run = await actLoseEveryShip(api);
    },

    async assert(api, check) {
      check.expectEq("the new game is in play", snap.screen, "playing");
      check.expectEq(
        "a new game reports 3 ships left — the one being flown plus its reserve of two",
        snap.lives,
        3,
      );

      check.expectEq(
        "losing the first ship respawns rather than ending the game",
        run.states[0],
        "playing",
      );
      check.expectEq(
        "losing the second ship respawns too — a third ship is still to come",
        run.states[1],
        "playing",
      );
      check.expectEq(
        "the run ends on the third loss: a new game gives exactly three ships",
        run.losses,
        3,
      );
      check.expectOk("the game is over once all three are gone", run.ended);
    },
  };
}
