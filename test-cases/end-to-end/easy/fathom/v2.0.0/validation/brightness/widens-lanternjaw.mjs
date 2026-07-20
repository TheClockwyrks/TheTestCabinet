// brightness.widens-lanternjaw: a higher G widens the Lanternjaw's detection range.
import { startPlaying, findOpenWithNeighbor, denAllExcept, pred, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("brightness.widens-lanternjaw");
  const snap = await startPlaying(api);
  const spot = findOpenWithNeighbor(snap, "right");
  await denAllExcept(api, ["lanternjaw"]);
  await api.call("setPredator", "lanternjaw", { tx: spot.tx, ty: spot.ty, mode: "wander" });
  // Clear the board (all but one pellet, placed adjacent to the stationary forager)
  // so the forager cannot eat and bump its own brightness while we read the range.
  await api.call("poseLastPlankton");

  await api.call("setBrightness", 0.1);
  await api.step(0.02);
  const low = pred(await api.snapshot(), "lanternjaw").detectRange;
  await api.call("setBrightness", 0.9);
  await api.step(0.02);
  const high = pred(await api.snapshot(), "lanternjaw").detectRange;

  check.expectGt("higher brightness widens the Lanternjaw's detection range", high, low);
  check.expectClose("range at low G (128 + 192*0.1)", low, 147, 18);
  check.expectClose("range at high G (128 + 192*0.9)", high, 301, 24);
  await clip(api, 700);
  return check.verdict();
}
