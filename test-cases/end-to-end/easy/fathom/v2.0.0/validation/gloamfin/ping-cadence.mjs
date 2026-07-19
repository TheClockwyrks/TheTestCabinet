// gloamfin.ping-cadence: while wandering it emits its own violet ping ~every 4 s.
import { startPlaying, denAllExcept, findFarTile, collectGloamPings, GLOAMFIN_PING_INTERVAL, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gloamfin.ping-cadence");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["gloamfin"]);
  const far = findFarTile(snap, snap.forager, 10); // far, so it wanders and self-pings
  await api.call("setPredator", "gloamfin", { tx: far.tx, ty: far.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  const pings = await collectGloamPings(api, 9);
  const violet = pings.filter((p) => p.tint === "violet");
  check.expectGt("the Gloamfin emits its own violet pings", violet.length, 0);
  if (violet.length >= 2) {
    const gap = violet[1].t - violet[0].t;
    check.expectClose("its ping cadence is ~4 s", gap, GLOAMFIN_PING_INTERVAL, 1.5);
  }
  await clip(api, 900);
  return check.verdict();
}
