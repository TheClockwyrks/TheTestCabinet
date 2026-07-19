// amber.drifter-score: eating a bonus drifter scores 200.
import { startPlaying, SCORE_DRIFTER, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("amber.drifter-score");
  await startPlaying(api);
  await api.call("poseLastPlankton"); // clear plankton so only the drifter scores here
  const f = (await api.snapshot()).forager;
  const before = (await api.snapshot()).score;
  await api.call("spawnDrifter", { tx: f.tx, ty: f.ty }); // on the forager's tile
  await api.step(0.05); // the real eat
  const after = await api.snapshot();
  check.expectEq("eating a drifter scores 200", after.score - before, SCORE_DRIFTER);
  await clip(api, 700);
  return check.verdict();
}
