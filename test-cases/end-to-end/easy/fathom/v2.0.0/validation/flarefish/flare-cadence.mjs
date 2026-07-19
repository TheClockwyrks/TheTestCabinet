// flarefish.flare-cadence: while wandering it flares about every 7 s (a short charge
// then a bloom).
import { startPlaying, denAllExcept, findFarTile, pred, stepUntil, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flarefish.flare-cadence");
  const snap = await startPlaying(api);
  await denAllExcept(api, ["flarefish"]);
  const far = findFarTile(snap, snap.forager, 8); // far, so it flares harmlessly
  await api.call("setPredator", "flarefish", { tx: far.tx, ty: far.ty, mode: "wander" });
  await api.call("poseLastPlankton");
  const r = await stepUntil(api, (s) => pred(s, "flarefish").flaring === true, 9.5, 0.1);
  check.expectOk("the Flarefish flares while wandering", r.hit);
  const p = pred(r.snap, "flarefish");
  check.expectGt("the bloom has a positive radius", p.flareRadius, 0);
  check.expectClose("the first flare comes on its ~7 s cadence", r.snap.simTime, 7.7, 1.6);
  await clip(api, 1000);
  return check.verdict();
}
