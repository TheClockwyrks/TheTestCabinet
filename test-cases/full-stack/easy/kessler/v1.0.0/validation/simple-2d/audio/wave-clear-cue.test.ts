// audio/wave-clear-cue — the wave-clear cue sounds once, on the tick the
// clearing event resolves, and on no tick before it.
//
// specs/rings.md: "Clearing a wave is an event: a hit from a ball destroys a
// target and leaves zero live targets across all three rings. At that instant
// every ball, every pod, every timed effect, and the shield are removed, with
// no life lost, the `wave-clear` cue plays, and the `waveclear` interstitial
// begins." specs/assets.md ties the produced file to exactly that event: "The
// event each cue plays on is fixed in the file that specifies the event".
//
// THE WORLD IS ONE TARGET AND ONE BALL. isolate() empties the field; the
// waveAdvance switch it holds off is turned back on, because the clearing
// event is exactly what this point sounds on, and podSpawn stays off so no
// pod arrives on top of the destruction. One hp-1 target stands on ring 1 —
// which does not orbit at wave 1, so the posed arc stays put — and the ball
// falls straight in onto it. The event tick is pinned by the screen the
// clearing enters; the destroying hit's own target-break cue is another
// item's point and goes uncounted here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  advanceTicks,
  captureReplay,
  cuesNamed,
  isolate,
  onCue,
  openHarness,
  spawnBallPolar,
  targetArcCenterDeg,
  type Harness,
} from "../harness";
import { sweepToEvent } from "./event-sweep";

/** The cue specs/rings.md has the clearing event play. */
const CUE = "wave-clear";

/** Ticks driven after the clearing: the clip's aftermath, and the echo check. */
const TRAIL_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds wave-clear once, on the tick the clearing resolves", async () => {
  isolate(h);
  h.debug.setWaveAdvance(true);
  h.debug.spawnTarget(1, 0, 1);
  spawnBallPolar(h, 350, targetArcCenterDeg(1, 0, 0), -240);

  const cues = onCue(h);
  const swept = await captureReplay(h, "clearing", async () => {
    const toClear = await sweepToEvent(
      h,
      cues,
      CUE,
      (s) => s.screen === "waveclear",
      60,
    );
    await advanceTicks(h, TRAIL_TICKS);
    return toClear;
  });

  assertTrue(swept.hit, "a clearing event within the 60-tick budget");
  assertEqual(
    swept.playsBeforeEventTick,
    0,
    `${CUE} plays over the fall before the clearing tick`,
  );
  assertEqual(
    swept.playsThroughEventTick,
    1,
    `${CUE} plays through the end of the clearing tick`,
  );
  assertEqual(
    cuesNamed(cues, CUE).length,
    1,
    `${CUE} plays after the aftermath ticks: the clearing's one play, unrepeated`,
  );
});
