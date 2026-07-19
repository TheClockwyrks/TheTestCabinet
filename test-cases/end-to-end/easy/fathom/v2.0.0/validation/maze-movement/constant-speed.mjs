// maze-movement.constant-speed: the forager travels corridors at ~128 px/s.
import { startPlaying, findStraightRun, DIR_KEY, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze-movement.constant-speed");
  const snap = await startPlaying(api);
  const run = findStraightRun(snap, 6);
  await api.call("setForager", { tx: run.tx, ty: run.ty });
  const before = (await api.snapshot()).forager;
  await api.call("keyDown", DIR_KEY[run.dir]);
  await api.step(0.5); // 128 px/s * 0.5 s = 64 px expected (exact under the manual clock)
  const after = (await api.snapshot()).forager;
  await api.call("keyUp", DIR_KEY[run.dir]);
  const dist = Math.hypot(after.x - before.x, after.y - before.y);
  check.expectClose(
    "the forager covers ~64 px in 0.5 s along a corridor (128 px/s)",
    dist,
    64,
    8,
  );
  await clip(api, 900);
  return check.verdict();
}
