// audio/ball-lost-cue — the ball-lost cue sounds once, on the tick a ball
// burns up against the planet, and on no tick before it.
//
// specs/field.md: "In a tick where a ball's center radius reaches `78` or
// less, the ball burns up: it is removed, the burn-up particle system spawns
// at it, and the `ball-lost` cue plays." specs/assets.md ties the produced
// file to exactly that event: "The event each cue plays on is fixed in the
// file that specifies the event"; "play a cue on its event". One burn-up, one
// play, on the burn-up's own tick; the ticks of plain inward fall before it
// belong to no event.
//
// THE WORLD IS ONE BALL AND THE PLANET. isolate() empties the field and holds
// both driver switches, and the one ball is sent straight inward on the far
// side from the deflector, so the burn-up is the only event the drive can
// resolve. The burn-up tick is read off `lives` (posed 3, one fewer on the
// tick the loss resolves), because the life-loss check parks a fresh ball
// inside the same tick — `balls` never reads empty. From radius 150 at 300
// units per second the fall covers 5 units of radius per tick and reaches the
// burn-up threshold of 78 on its 15th tick, never landing on the boundary, so
// the 60-tick budget is generous.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { START_LIVES } from "../constants";
import {
  advanceTicks,
  captureReplay,
  cuesNamed,
  isolate,
  onCue,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { sweepToEvent } from "./event-sweep";

/** The cue specs/field.md has the burn-up play. */
const CUE = "ball-lost";

/** Ticks driven after the burn-up: the clip's aftermath, and the echo check. */
const TRAIL_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds ball-lost once, on the tick the burn-up resolves", async () => {
  await h.armAudio();
  await isolate(h);
  await spawnBallPolar(h, 150, 270, 300, 180);

  const cues = onCue(h);
  const swept = await captureReplay(h, "burnup", async () => {
    const toBurn = await sweepToEvent(
      h,
      cues,
      CUE,
      (s) => s.lives < START_LIVES,
      60,
    );
    await advanceTicks(h, TRAIL_TICKS);
    return toBurn;
  });

  assertTrue(swept.hit, "a burn-up within the 60-tick budget");
  assertEqual(
    swept.playsBeforeEventTick,
    0,
    `${CUE} plays over the inward fall before the burn-up tick`,
  );
  assertEqual(
    swept.playsThroughEventTick,
    1,
    `${CUE} plays through the end of the burn-up tick`,
  );
  assertEqual(
    cuesNamed(cues, CUE).length,
    1,
    `${CUE} plays after the aftermath ticks: the burn-up's one play, unrepeated`,
  );
});
