// standard.amber-any-distance: the amber lights show at any distance in the standard dive,
// even far out in the dark (not clipped to a window).
//
// The distant drifter is posed instantly (`arrange`); `act` lets the pose settle, gives
// the build a frame to paint, and reads the amber halo back off the canvas.
import {
  amberInProfile,
  denAllExcept,
  findFarTile,
  quietBoard,
  sampleMoteProfile,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let hasDrifter;
  let profile;

  return {
    id: "standard.amber-any-distance",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, []);
      const far = findFarTile(snap, snap.forager, 9); // far out in the dark
      await api.call("spawnDrifter", { tx: far.tx, ty: far.ty });
      await quietBoard(api);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      const d = (await api.snapshot()).drifters[0];
      hasDrifter = Boolean(d);
      // A REAL pause (the old wait(120)) so the drifter has been painted before sampling.
      await api.settle(120);
      // The mote read across its whole profile rather than at one fixed ring: the spec
      // fixes the amber, not the size of the glow it is painted in (see `MOTE_RADII`).
      profile = await sampleMoteProfile(api, d.x, d.y);
      await api.screenshot("amber");
    },

    async assert(api, check) {
      check.expectOk("the distant drifter exists", hasDrifter);
      check.expectOk(
        "the distant amber drifter is still drawn amber",
        Boolean(amberInProfile(profile)),
      );
    },
  };
}
