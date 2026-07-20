// brightness.holds-decays: G holds ~1 s after the last pellet, then decays — never a
// constant drain.
import { startPlaying, findOpenWithNeighbor, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("brightness.holds-decays");
  const snap = await startPlaying(api);
  const spot = findOpenWithNeighbor(snap, "right");
  await api.call("setForager", { tx: spot.tx, ty: spot.ty });
  await api.step(0.05); // eat this tile so the forager now rests on empty ground
  await api.call("setBrightness", 1); // set G high and arm the hold (as a fresh eat would)
  const g0 = (await api.snapshot()).brightness;
  await api.step(0.9); // still inside the ~1 s hold window
  const gHold = (await api.snapshot()).brightness;
  await api.step(1.0); // past the hold, into the decay
  const gDecay = (await api.snapshot()).brightness;

  check.expectEq("brightness starts high", g0, 1);
  check.expectGt("brightness holds (no drain) inside the hold window", gHold, 0.95);
  check.expectLt("brightness decays once the hold expires", gDecay, gHold - 0.2);
  await clip(api, 700);
  return check.verdict();
}
