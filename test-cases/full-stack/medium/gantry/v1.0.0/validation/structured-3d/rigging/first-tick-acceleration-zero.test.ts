// rigging/first-tick-acceleration-zero — the run's first tick carries no
// acceleration, however sharply the pivot moved on it.
//
// `specs/rigging.md` § The pendulum tick: "On a run's first tick the acceleration
// is zero, whatever velocity the steps above leave." The tension is what that
// figure reaches — "`T = m * (a - g)`" — so on the first tick the cable pulls
// `m * GRAVITY` up the cable and nothing more, which for the bare hook is `50`
// against the `HOIST_CABLE_CAP` of `3000`. A tick whose `|T|` exceeds that cap
// "snaps the cable and ends the run as `cable-snap`", so the first tick's rule is
// exactly what stands between this run and that verdict.
//
// THE PIVOT IS MOVED A UNIT ON THE TICK ITSELF. `setAxis("trolley", value)`
// "sets an axis's value, leaving it stopped with no live command"
// (`specs/instrumentation.md`), so the tick's geometry stands the pivot a unit
// from where the run started; step 5 reads `vP` as `60` units a second and the
// tick leaves the bob moving at about `27`. Read as an ordinary tick that is an
// acceleration of some sixteen hundred and a tension near `8000`, well past the
// cap — so a build that skipped the first-tick rule ends this run on its first
// tick, and one that kept it carries on.
//
// AND THE CONTROL IS THE SAME POSE ONE TICK LATER. Without it a build that never
// snaps at all would pass by doing nothing, so the identical unit of trolley is
// posed on a second run's SECOND tick, where the rule does not apply and the run
// must end as `cable-snap`. The snap rule itself is another point's; what it
// serves here is to say that the first tick's survival was the first-tick rule
// and not a missing cable.
//
// Nothing is posed onto the bob: the velocity each tick begins with is the one
// the tick before it left, so this rests on nothing about how a posed velocity is
// carried into an acceleration.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A tape that keeps a run legal and asks nothing of the rigging. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Where the trolley is posed: a unit along a track four units long. */
const ALONG = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries no acceleration on the first tick, however the pivot moved", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);

  await startRun(h);
  await h.debug.setAxis("trolley", ALONG);
  const first = (await runTicks(h, 1)).run;

  await h.capture("first", "The first tick absorbing the posed velocity");

  assertEqual(
    first.phase,
    "running",
    "the run after a first tick that carried the pivot a unit along the " +
      "track: its acceleration is zero, so the cable's tension is the bob's " +
      "weight and nothing snaps (specs/rigging.md)",
  );

  // The control: the identical pose on a tick the rule does not cover.
  await h.debug.abortRun();
  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setAxis("trolley", ALONG);
  const later = (await runTicks(h, 1)).run;

  assertEqual(
    later.cause,
    "cable-snap",
    "the same pose on a run's SECOND tick, where the acceleration is the " +
      "change in the bob's velocity over the tick and the tension far " +
      "exceeds HOIST_CABLE_CAP (specs/rigging.md) — the control that makes " +
      "the first tick's survival a reading of the first-tick rule",
  );
});
