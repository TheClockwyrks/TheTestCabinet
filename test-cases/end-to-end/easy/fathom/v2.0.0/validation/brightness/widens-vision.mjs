// brightness.widens-vision: eating a plankton widens the light radius V.
//
// The companion of brightness.from-eating (which checks the brightness raise from the
// same eat): here the light radius V must grow as brightness rises. The forager is stood
// at the head of a dark corridor with pellets ahead of it in `arrange`; the eat it swims
// into is the real sim, so it is `act` and is what the clip shows — the light opening up
// around a forager that keeps grazing. See `arrangeGraze` / `actGrazeOne`.
import { arrangeGraze, actGrazeOne } from "../_helpers.mjs";

export default function item() {
  let run;
  let graze;

  return {
    id: "brightness.widens-vision",

    async arrange(api) {
      ({ run } = await arrangeGraze(api));
    },

    async act(api) {
      graze = await actGrazeOne(api, run.dir);
    },

    async assert(api, check) {
      check.expectOk("the forager swam into a plankton", graze.hit);
      if (!graze.hit) return;
      check.expectGt(
        "the light radius V widens as brightness rises from eating",
        graze.after.visionRadius,
        graze.before.visionRadius,
      );
    },
  };
}
