// maze-movement.reverse-anytime: reversal is allowed away from a tile center.
import { startPlaying, findStraightRun, DIR_KEY, OPP, DIRS, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze-movement.reverse-anytime");
  const snap = await startPlaying(api);
  const run = findStraightRun(snap, 4);
  const [dc, dr] = DIRS[run.dir];
  // A tile inside the run, so both forward and backward are open.
  await api.call("setForager", { tx: run.tx + dc, ty: run.ty + dr });
  await api.call("keyDown", DIR_KEY[run.dir]);
  await api.step(0.1); // moving, mid-tile
  const moving = (await api.snapshot()).forager;
  check.expectEq("the forager is heading forward", moving.dir, run.dir);
  await api.call("keyDown", DIR_KEY[OPP[run.dir]]); // press the opposite while mid-tile
  await api.step(0.05);
  const rev = (await api.snapshot()).forager;
  await api.call("keyUp", DIR_KEY[run.dir]);
  await api.call("keyUp", DIR_KEY[OPP[run.dir]]);
  check.expectEq(
    "pressing the opposite reverses the forager immediately (mid-tile)",
    rev.dir,
    OPP[run.dir],
  );
  await clip(api, 800);
  return check.verdict();
}
