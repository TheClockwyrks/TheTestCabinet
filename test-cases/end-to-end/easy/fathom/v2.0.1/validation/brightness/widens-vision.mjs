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
      // Read a beat after the eat rather than on its own tick: `V` is DERIVED from `G`
      // (`V = 96 + 64 G`, specs/gameplay.md), and a build that recomputes it at the top of
      // the next step is satisfying that formula just as much as one that recomputes it
      // inside the step that raised `G`. See `actGrazeOne` for why the beat is where it is.
      check.expectGt(
        `the light radius V widens as brightness rises from eating ` +
          `(${graze.before.visionRadius} px at G=${graze.before.brightness.toFixed(2)} ` +
          `to ${graze.settled.visionRadius} px at G=${graze.settled.brightness.toFixed(2)})`,
        graze.settled.visionRadius,
        graze.before.visionRadius,
      );
    },
  };
}
