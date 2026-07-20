// Trains: throwing a junction lever diverts the next train on its track onto the siding
// line. Level 5's lever L1 controls T1 (default line 4, siding line 3). The worker throws
// the lever for real (E), then the sim runs until T1's first scheduled train enters — on 3.

import { pressStep, setTile, startFresh, trainsOn, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trains.switch");

  await startFresh(api, 5);
  await setTile(api, 6, 5); // beside the lever at (6,4)
  await pressStep(api, "KeyE"); // throw the lever for real
  const lever = (await api.snapshot()).levers.find((l) => l.id === "L1");
  check.expectOk("the lever is thrown", lever && lever.thrown === true);

  await api.step(2.3); // past T1's first entry (phase 2.0)
  const t1 = trainsOn(await api.snapshot(), "T1");
  check.expectGt("a T1 train has entered", t1.length, 0);
  if (t1.length) check.expectEq("it was diverted onto the siding line (3)", t1[0].line, 3);

  await liveClip(api, 900);
  return check.verdict();
}
