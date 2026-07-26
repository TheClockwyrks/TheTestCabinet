// brightness.holds-decays: G holds ~1 s after the last pellet, then decays — never a
// constant drain.
//
// Only the placement is instant; clearing the tile, holding, and decaying are all real
// elapsed time, so they belong in `act` — which is also the clip, where the hold and
// then the fall are visible at the game's own pace.
import { startPlaying, findOpenWithNeighbor } from "../_helpers.mjs";

export default function item() {
  let g0;
  let gHold;
  let gDecay;

  return {
    id: "brightness.holds-decays",

    async arrange(api) {
      const snap = await startPlaying(api);
      const spot = findOpenWithNeighbor(snap, "right");
      await api.call("setForager", { tx: spot.tx, ty: spot.ty });
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s: eat this tile so the forager rests on empty ground
      await api.call("setBrightness", 1); // set G high and arm the hold (as a fresh eat would)
      g0 = (await api.snapshot()).brightness;
      await api.advance(108); // 108 ticks = the old 0.9 s: still inside the ~1 s hold window
      gHold = (await api.snapshot()).brightness;
      await api.advance(120); // 120 ticks = the old 1.0 s: past the hold, into the decay
      gDecay = (await api.snapshot()).brightness;
      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectEq("brightness starts high", g0, 1);
      check.expectGt(
        "brightness holds (no drain) inside the hold window",
        gHold,
        0.95,
      );
      check.expectLt(
        "brightness decays once the hold expires",
        gDecay,
        gHold - 0.2,
      );
    },
  };
}
