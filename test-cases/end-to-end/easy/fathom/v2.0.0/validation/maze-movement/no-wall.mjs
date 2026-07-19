// maze-movement.no-wall: holding a direction into a wall does not move the forager.
import { startPlaying, findOpenWithWall, DIR_KEY, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze-movement.no-wall");
  const snap = await startPlaying(api);
  let dir = null;
  let spot = null;
  for (const d of ["up", "right", "down", "left"]) {
    try {
      spot = findOpenWithWall(snap, d);
      dir = d;
      break;
    } catch {
      /* try the next direction */
    }
  }
  if (!dir) throw new Error("no open tile bordered by a wall");
  await api.call("setForager", { tx: spot.tx, ty: spot.ty });
  const before = (await api.snapshot()).forager;
  await api.call("keyDown", DIR_KEY[dir]);
  await api.step(0.3);
  const after = (await api.snapshot()).forager;
  await api.call("keyUp", DIR_KEY[dir]);
  check.expectEq("the forager stays on its tile against the wall", `${after.tx},${after.ty}`, `${before.tx},${before.ty}`);
  check.expectOk("the forager does not enter the wall (not moving)", after.moving === false);
  await clip(api, 600);
  return check.verdict();
}
