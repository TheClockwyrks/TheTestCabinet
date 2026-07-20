// scoring.caught-costs-life: contact with a predator costs a life and resets the trench.
//
// The chasing predator is put on the forager's tile with control ops (`arrange`); the
// collision it causes is the real sim, so it is `act` — the clip is the catch itself and
// the trench resetting behind it.
import { startPlaying, denAllExcept } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "scoring.caught-costs-life",

    async arrange(api) {
      await startPlaying(api);
      before = await api.snapshot();
      const f = before.forager;
      await denAllExcept(api, ["gloamfin"]);
      // Put a chasing predator on the forager's tile so a real collision occurs.
      await api.call("setPredator", "gloamfin", {
        tx: f.tx,
        ty: f.ty,
        mode: "chase",
      });
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      after = await api.snapshot();
      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectEq("contact costs a life", after.lives, before.lives - 1);
      check.expectEq(
        "the trench resets (back to the dive countdown)",
        after.screen,
        "countdown",
      );
    },
  };
}
