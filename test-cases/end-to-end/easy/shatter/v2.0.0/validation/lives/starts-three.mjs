// Automated validation for the Lives item `starts-three`: a new game starts with 3 ships.
// A real game is started (through the same path PLAY takes), the fresh HUD is captured, and
// then the game is made to prove the count: ships are lost one at a time, and the run must
// survive the first two losses and end on the third.
//
// It is driven that way because the `lives` NUMBER cannot settle this on its own.
// `specs/gameplay.md` says a game starts with 3 ships; `specs/instrumentation.md` defines the
// snapshot field as "ships in reserve" and `specs/ui.md` draws "one [glyph] per life still in
// reserve". A build that launches three ships and reports `lives: 2` — the two waiting behind
// the one being flown — satisfies all three sentences, and so does one that reports `lives:
// 3`. Reading 3 out of a fresh game therefore tests a counting convention the case never
// picked, and fails a build for choosing the other one. How many ships a game actually gives
// is not a convention: it is how many losses it takes to end the run, which is what this
// drives. The reported count is still checked, but only against the range both conventions
// allow.
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
      check.expectGe(
        "a new game reports at least two ships (its reserve, however counted)",
        snap.lives,
        2,
      );
      check.expectLe(
        "and no more than three (the flying ship plus its reserve)",
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
