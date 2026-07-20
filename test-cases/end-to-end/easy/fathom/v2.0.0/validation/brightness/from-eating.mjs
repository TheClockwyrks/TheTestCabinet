// brightness.from-eating: eating a plankton raises brightness (~+0.34) and widens V.
import {
  startPlaying,
  findOpenWithNeighbor,
  BRIGHT_PER_EAT,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("brightness.from-eating");
  const snap = await startPlaying(api);
  // Place the forager on a fresh corridor tile (which carries a plankton) so a
  // single real eat is measured cleanly.
  const spot = findOpenWithNeighbor(snap, "right");
  await api.call("setForager", { tx: spot.tx, ty: spot.ty });
  const before = await api.snapshot();
  await api.step(0.05); // the real eat on the forager's tile
  const after = await api.snapshot();
  check.expectClose(
    "eating a plankton raises brightness by ~0.34",
    after.brightness - before.brightness,
    BRIGHT_PER_EAT,
    0.06,
  );
  check.expectGt(
    "the light radius V widens as brightness rises",
    after.visionRadius,
    before.visionRadius,
  );
  await clip(api, 800);
  return check.verdict();
}
