// audio/denied-cue — the cue a refused shot plays is `denied`.
//
// THE SPEC LINE. `specs/ui.md` ("Audio"): `denied` is played when "The fire
// action is read while the injector's cooldown is still running".
// `specs/injector.md` fixes the cooldown at `FIRE_COOLDOWN` (0.18 s), which is
// 10.8 ticks, so a control raised on the tick after a shot is well inside it.
//
// HOW THE COOLDOWN IS STARTED. With a real press of the fire control, which
// sounds `fire` on its own tick, and the refused press follows on the very
// next one. Two presses rather than a posed `fire()`, because a pose "sounds
// nothing; the cues a scenario hears come from the ticks run after it" — so a
// posed shot's cue would land on the refused press's own tick and the two
// would be indistinguishable. Started this way the refusal's tick carries the
// refusal alone, and `fire` is asserted absent from it: a build that plays its
// shot cue on a shot it refused fails here.
//
// WHAT ELSE IS READ. That no second projectile appeared, so the press really
// was refused rather than honored. How the refusal itself behaves is
// `injector/cooldown-blocks`' point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseHall,
  pressFire,
  watchCues,
  type Harness,
} from "../harness";
import { assertHeardOnce, assertSilentOn, openHall, QUIET_CORES } from "./cues";

/** Ticks recorded after the refusal, so the clip shows the one shot flying. */
const TRAIL_TICKS = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the denied cue when the fire control is raised inside the cooldown", async () => {
  await openHall(h);
  await poseHall(h, { cores: QUIET_CORES });

  // The honored shot, which starts the cooldown the press below runs into.
  const honored = await pressFire(h);
  assertEqual(
    honored.projectiles.length,
    1,
    "the projectiles the honored press put in the hall",
  );

  const played = watchCues(h);
  const refused = await captureReplay(h, "denied", async () => {
    const after = await pressFire(h);
    const measured = { after, tick: h.tick(), cues: [...played] };
    await h.step(TRAIL_TICKS);
    return measured;
  });

  assertEqual(
    refused.after.projectiles.length,
    1,
    "the projectiles after a fire input one tick into the 0.18 s cooldown",
  );
  assertHeardOnce(
    refused.cues,
    refused.tick,
    "denied",
    "the denied cue on the tick the refused press was read",
  );
  assertSilentOn(
    refused.cues,
    refused.tick,
    ["fire"],
    "the fire cue on a tick that fired nothing",
  );
});
