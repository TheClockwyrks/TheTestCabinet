// kindle.grows-with-eating: the vision-circle radius grows with brightness (R = 192 + 128 G).
//
// Entering play and clearing the board is instant (`arrange`); the two brightness settings
// and the moment each needs to take effect in the sim are `act`, so the clip shows the
// circle at rest and then wide.
import { quietBoard, startPlaying } from "../_helpers.mjs";

export default function item() {
  let r0;
  let r1;

  return {
    id: "kindle.grows-with-eating",

    async arrange(api) {
      await startPlaying(api);
      await quietBoard(api); // keep the forager from eating and skewing G
    },

    async act(api) {
      // Each `advance(2)` is the old step(0.02) = 2.4 ticks, which the contract refuses
      // to round. These are "let the setting take effect" beats, not measured durations,
      // so 2 ticks is the faithful whole-tick choice.
      await api.call("setBrightness", 0);
      await api.advance(2);
      r0 = (await api.snapshot()).windowRadius;
      await api.call("setBrightness", 1);
      await api.advance(2);
      r1 = (await api.snapshot()).windowRadius;
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectGt("the vision circle grows with brightness", r1, r0);
      check.expectClose("radius at G=0 is ~192 px", r0, 192, 20);
      check.expectClose("radius at G=1 is ~320 px", r1, 320, 24);
    },
  };
}
