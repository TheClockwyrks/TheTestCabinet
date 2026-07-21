// maze-movement.reverse-anytime: reversal is allowed away from a tile center.
//
// Standing the forager inside a straight run is instant (`arrange`); getting it moving,
// pressing the opposite key mid-tile and reading the new heading is the real sim, so it
// is `act`. Both keys stay held through the tail so the clip shows the forager actually
// swimming back the way it came.
import {
  startPlaying,
  findStraightRun,
  DIR_KEY,
  OPP,
  DIRS,
} from "../_helpers.mjs";

export default function item() {
  let run;
  let moving;
  let rev;

  return {
    id: "maze-movement.reverse-anytime",

    async arrange(api) {
      const snap = await startPlaying(api);
      run = findStraightRun(snap, 4);
      const [dc, dr] = DIRS[run.dir];
      // A tile inside the run, so both forward and backward are open.
      await api.call("setForager", { tx: run.tx + dc, ty: run.ty + dr });
    },

    async act(api) {
      await api.call("keyDown", DIR_KEY[run.dir]);
      await api.advance(12); // 12 ticks = the old 0.1 s: moving, mid-tile
      moving = (await api.snapshot()).forager;
      await api.call("keyDown", DIR_KEY[OPP[run.dir]]); // press the opposite while mid-tile
      await api.advance(6); // 6 ticks = the old 0.05 s
      rev = (await api.snapshot()).forager;
      await api.advance(96); // 96 ticks = the old 800 ms live tail, both keys still held
      await api.call("keyUp", DIR_KEY[run.dir]);
      await api.call("keyUp", DIR_KEY[OPP[run.dir]]);
    },

    async assert(api, check) {
      check.expectEq("the forager is heading forward", moving.dir, run.dir);
      check.expectEq(
        "pressing the opposite reverses the forager immediately (mid-tile)",
        rev.dir,
        OPP[run.dir],
      );
    },
  };
}
