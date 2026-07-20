// fog.predators-not-remembered: a predator body shows only while lit, and is dropped
// (not left drawn in memory) once the light moves off it.
import {
  startPlaying,
  findSightLine,
  openTiles,
  denAllExcept,
  pred,
  clip,
} from "../_helpers.mjs";

const man = (a, b, c, d) => Math.abs(a - c) + Math.abs(b - d);

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fog.predators-not-remembered");
  const snap = await startPlaying(api);
  const line = findSightLine(snap, 3); // forager + gloamfin 3 tiles apart, clear LOS
  await denAllExcept(api, ["gloamfin"]);
  await api.call("setForager", { tx: line.forager.tx, ty: line.forager.ty });
  await api.call("setPredator", "gloamfin", {
    tx: line.pred.tx,
    ty: line.pred.ty,
    mode: "wander",
  });
  await api.call("setBrightness", 1); // widen the light so the Gloamfin's tile is lit
  await api.step(0.05);
  check.expectOk(
    "the Gloamfin body is drawn while lit",
    pred(await api.snapshot(), "gloamfin").lit === true,
  );

  // Move the forager far away and dim so the light leaves the Gloamfin.
  const far = openTiles(snap).find(
    ([c, r]) => man(c, r, line.pred.tx, line.pred.ty) > 8,
  );
  if (!far) throw new Error("no far tile to move the forager to");
  await api.call("setForager", { tx: far[0], ty: far[1] });
  await api.call("setBrightness", 0);
  await api.step(0.1);
  check.expectOk(
    "the Gloamfin body is dropped once unlit (not remembered)",
    pred(await api.snapshot(), "gloamfin").lit === false,
  );
  await clip(api, 700);
  return check.verdict();
}
