// brightness.from-eating: eating a plankton raises brightness G by ~+0.34.
//
// (Its companion, brightness.widens-vision, checks the light radius V from the same
// eat.) The forager is stood at the head of a dark corridor with pellets ahead of it in
// `arrange`; the eat it swims into is the real sim, so it is `act` and is what the clip
// shows — a forager grazing along and visibly kindling, rather than a step change on a
// pellet it was posed on top of. See `arrangeGraze` / `actGrazeOne`.
import { arrangeGraze, actGrazeOne, BRIGHT_PER_EAT } from "../_helpers.mjs";

export default function item() {
  let run;
  let graze;

  return {
    id: "brightness.from-eating",

    async arrange(api) {
      ({ run } = await arrangeGraze(api));
    },

    async act(api) {
      graze = await actGrazeOne(api, run.dir);
    },

    async assert(api, check) {
      check.expectOk("the forager swam into a plankton", graze.hit);
      if (!graze.hit) return;
      check.expectClose(
        "eating a plankton raises brightness by ~0.34",
        graze.after.brightness - graze.before.brightness,
        BRIGHT_PER_EAT,
        0.06,
      );
    },
  };
}
