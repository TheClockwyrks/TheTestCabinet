// Automated validation for the Waves item `count-increases`: clearing every rock advances
// to a new wave with more rocks. A real game is started (wave 1) and its rock count read;
// the field is then cleared, and after the wave banner elapses the real spawner brings in
// the next, denser wave, whose number and count are read back.
//
// Only starting the game is a precondition (`arrange`). Reading wave 1, clearing the field and
// waiting out the banner all belong to `act` — `clearRocks` is a control op, which is legal
// there — so the clip shows the transition itself: a full field, then an empty one, then the
// denser wave arriving. 1.7 s x 120 Hz = 204 ticks.

export default function item() {
  // The state of wave 1 and of the wave that replaced it, read by `assert`.
  let w1;
  let w2;

  return {
    id: "waves.count-increases",

    async arrange(api) {
      await api.reset({ seed: 3 });
      await api.call("startGame");
      await api.call("setInvuln", 99); // seconds — keep the ship alive through the measurement
    },

    async act(api) {
      w1 = await api.snapshot();

      await api.call("clearRocks"); // as if every rock were destroyed
      await api.advance(204); // let the WAVE banner elapse and the next wave spawn
      w2 = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("wave 1 is the current wave", w1.wave, 1);
      check.expectEq("wave 1 fields four rocks", w1.rocks.length, 4);
      check.expectEq("clearing the field advances to wave 2", w2.wave, 2);
      check.expectEq("wave 2 fields more rocks (five)", w2.rocks.length, 5);
    },
  };
}
