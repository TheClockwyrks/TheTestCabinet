// gloamfin.lost-you-orange: reaching where it last heard you and finding you gone, it
// fires a guaranteed orange "lost you" ping (distinct from its usual violet).
import {
  startPlaying,
  findSightLine,
  findFarTile,
  denAllExcept,
  collectGloamPings,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gloamfin.lost-you-orange");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 3);
  await denAllExcept(api, ["gloamfin"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  // Chase fixes on the forager's current tile (line.forager).
  await api.call("setPredator", "gloamfin", { tx: line.pred.tx, ty: line.pred.ty, mode: "chase" });
  // Now move the forager far away, so when the Gloamfin reaches the fix it is empty.
  const far = findFarTile(snap, line.forager, 9);
  await api.call("setForager", { tx: far.tx, ty: far.ty });
  await api.call("poseLastPlankton");
  const pings = await collectGloamPings(api, 6);
  check.expectOk(
    "it fires a distinct orange 'lost you' ping after reaching the empty fix",
    pings.some((p) => p.tint === "orange"),
  );
  await clip(api, 800);
  return check.verdict();
}
