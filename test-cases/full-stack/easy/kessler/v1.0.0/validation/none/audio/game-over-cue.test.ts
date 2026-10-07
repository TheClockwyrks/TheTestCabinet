// audio/game-over-cue — the game-over cue sounds once, on entering the
// gameover screen, and not before.
//
// specs/screens.md, on `gameover`: "Entering it plays the `game-over` cue".
// specs/field.md fixes the entering: "if this tick's burn-ups removed the
// last live ball, one life is lost ... At zero lives the game moves to the
// `gameover` screen." specs/assets.md: "The event each cue plays on is fixed
// in the file that specifies the event".
//
// THE ENTRY IS THE REAL ONE. A posed setScreen("gameover") sounds nothing —
// specs/instrumentation.md: "No cue sounds at the call" — so the screen is
// entered the one way that plays the cue: the last life is spent. isolate()
// empties the field, lives are posed to 1, and the one ball is sent straight
// inward on the far side from the deflector; the burn-up's own ball-lost cue
// shares the tick and is another item's point, so it goes uncounted here.
// The gameover screen advances nothing after the entry, and the trail ticks
// confirm the cue does not repeat over it.

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
  type Harness,
} from "../harness";
import { sweepToEvent } from "./event-sweep";

/** The cue specs/screens.md has the gameover entry play. */
const CUE = "game-over";

/** Ticks driven after the entry: the clip's aftermath, and the echo check. */
const TRAIL_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds game-over once, on the tick the last life is spent", async () => {
  await h.armAudio();
  await isolate(h);
  await h.debug.setLives(1);
  await spawnBallPolar(h, 150, 270, 300, 180);

  const cues = onCue(h);
  const swept = await captureReplay(h, "last-life", async () => {
    const toEnd = await sweepToEvent(
      h,
      cues,
      CUE,
      (s) => s.screen === "gameover",
      60,
    );
    await advanceTicks(h, TRAIL_TICKS);
    return toEnd;
  });

  assertTrue(swept.hit, "a gameover entry within the 60-tick budget");
  assertEqual(
    swept.playsBeforeEventTick,
    0,
    `${CUE} plays over the fall before the entering tick`,
  );
  assertEqual(
    swept.playsThroughEventTick,
    1,
    `${CUE} plays through the end of the entering tick`,
  );
  assertEqual(
    cuesNamed(cues, CUE).length,
    1,
    `${CUE} plays after the aftermath ticks: the entry's one play, unrepeated`,
  );
});
