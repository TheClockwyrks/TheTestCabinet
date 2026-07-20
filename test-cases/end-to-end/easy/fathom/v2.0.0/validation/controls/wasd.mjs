// controls.wasd: W/A/S/D move the forager up/left/down/right like the arrows.
import { startPlaying, findOpenWithNeighbor, movedAlong, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.wasd");
  const map = [
    ["KeyW", "up"],
    ["KeyA", "left"],
    ["KeyS", "down"],
    ["KeyD", "right"],
  ];
  for (const [code, dir] of map) {
    const snap = await startPlaying(api);
    const spot = findOpenWithNeighbor(snap, dir);
    await api.call("setForager", { tx: spot.tx, ty: spot.ty });
    const before = (await api.snapshot()).forager;
    await api.call("keyDown", code);
    await api.step(0.25);
    const after = (await api.snapshot()).forager;
    await api.call("keyUp", code);
    check.expectOk(
      `${code} moves the forager ${dir}`,
      movedAlong(before, after, dir) && after.dir === dir,
    );
  }
  await clip(api, 700);
  return check.verdict();
}
