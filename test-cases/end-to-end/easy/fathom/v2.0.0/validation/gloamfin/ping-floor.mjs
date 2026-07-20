// gloamfin.ping-floor: it never fires two pings closer than ~3 s apart.
import {
  startPlaying,
  denAllExcept,
  findFarTile,
  collectGloamPings,
  GLOAMFIN_PING_MIN_GAP,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gloamfin.ping-floor");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["gloamfin"]);
  const far = findFarTile(snap, snap.forager, 8);
  await api.call("setPredator", "gloamfin", { tx: far.tx, ty: far.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  const pings = await collectGloamPings(api, 12);
  check.expectGt("several pings are observed", pings.length, 1);
  let minGap = Infinity;
  for (let i = 1; i < pings.length; i++) minGap = Math.min(minGap, pings[i].t - pings[i - 1].t);
  check.expectGt(
    "no two pings fire closer than the ~3 s floor",
    minGap,
    GLOAMFIN_PING_MIN_GAP - 0.2,
  );
  await clip(api, 800);
  return check.verdict();
}
