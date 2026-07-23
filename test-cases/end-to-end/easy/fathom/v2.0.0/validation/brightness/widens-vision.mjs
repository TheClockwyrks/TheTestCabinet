// brightness.widens-vision: eating a plankton widens the light radius V.
//
// The companion of brightness.from-eating (which checks the brightness raise from the
// same eat): here the light radius V must grow as brightness rises. Placing the forager
// on a fresh pellet tile is instant (`arrange`); the eat itself is the real sim running,
// so it is `act` and is what the clip shows.
import { startPlaying, findOpenWithNeighbor } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "brightness.widens-vision",

    async arrange(api) {
      const snap = await startPlaying(api);
      // Place the forager on a fresh corridor tile (which carries a plankton) so a
      // single real eat is measured cleanly.
      const spot = findOpenWithNeighbor(snap, "right");
      await api.call("setForager", { tx: spot.tx, ty: spot.ty });
    },

    async act(api) {
      before = await api.snapshot();
      await api.advance(6); // 6 ticks = the old 0.05 s: the real eat on the forager's tile
      after = await api.snapshot();
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectGt(
        "the light radius V widens as brightness rises from eating",
        after.visionRadius,
        before.visionRadius,
      );
    },
  };
}
