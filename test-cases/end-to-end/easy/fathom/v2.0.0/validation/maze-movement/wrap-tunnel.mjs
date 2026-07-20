// maze-movement.wrap-tunnel: travelling into the wrap tunnel carries the forager
// continuously out the opposite edge.
import { startPlaying, wrapRow, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze-movement.wrap-tunnel");
  const snap = await startPlaying(api);
  const wr = wrapRow(snap);
  check.expectOk("the trench has a horizontal wrap tunnel", wr >= 0);
  if (wr < 0) return check.verdict();

  await api.call("setForager", { tx: 0, ty: wr });
  const before = (await api.snapshot()).forager;
  await api.call("keyDown", "ArrowLeft");
  await api.step(0.15); // step off the left edge into the tunnel
  const after = (await api.snapshot()).forager;
  await api.call("keyUp", "ArrowLeft");
  check.expectGt(
    "moving off the left edge wraps the forager to the right edge",
    after.tx,
    snap.grid.cols - 3,
  );
  await clip(api, 800);
  return check.verdict();
}
