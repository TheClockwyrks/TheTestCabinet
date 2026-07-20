// flarefish.flare-reveals: the flare reveals a radial disc of tiles (floor and wall)
// to the player, through walls.
import { startPlaying, denAllExcept, findFarTile, pred, stepUntil, clip } from "../_helpers.mjs";

function revealedNear(s, tx, ty, rad) {
  let n = 0;
  for (let r = 0; r < s.grid.rows; r++) {
    for (let c = 0; c < s.grid.cols; c++) {
      if (Math.abs(c - tx) + Math.abs(r - ty) > rad) continue;
      const v = s.visibility[r][c];
      if (v === "l" || v === "r") n++;
    }
  }
  return n;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flarefish.flare-reveals");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["flarefish"]);
  const far = findFarTile(snap, snap.forager, 9); // in an unrevealed region far from the light
  await api.call("setPredator", "flarefish", { tx: far.tx, ty: far.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  const before = revealedNear(await api.snapshot(), far.tx, far.ty, 4);
  const r = await stepUntil(api, (s) => pred(s, "flarefish").flaring === true, 9.5, 0.1);
  check.expectOk("the Flarefish flares", r.hit);
  const fx = pred(r.snap, "flarefish");
  const after = revealedNear(r.snap, fx.tx, fx.ty, 4);
  check.expectGt("the flare reveals a disc of tiles around the Flarefish", after, before);
  await clip(api, 1000);
  return check.verdict();
}
