// scoring.plankton: eating a plankton scores 10 and clears it from the trench.
import { startPlaying, findOpenWithNeighbor, SCORE_PLANKTON, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.plankton");
  const snap = await startPlaying(api);
  const spot = findOpenWithNeighbor(snap, "right"); // a fresh corridor tile (carries a plankton)
  await api.call("setForager", { tx: spot.tx, ty: spot.ty });
  const before = await api.snapshot();
  await api.step(0.05); // the real eat on the forager's tile
  const after = await api.snapshot();
  check.expectEq("eating a plankton scores 10", after.score - before.score, SCORE_PLANKTON);
  check.expectEq(
    "the plankton is cleared from the trench",
    before.planktonRemaining - after.planktonRemaining,
    1,
  );
  await clip(api, 700);
  return check.verdict();
}
