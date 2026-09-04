// instrumentation/wave-advance-switch-resumes — the switch back on clears from
// the next qualifying destruction, and catches nothing up.
//
// specs/instrumentation.md, of a switch coming back on: "Turning one back on
// resumes that consequence from the next event onward, with no catching up for
// the events it missed."
//
// THE SCENE HAS A MISSED EVENT TO NOT CATCH UP. A first destruction, with the
// switch off, empties the field; the switch is then turned back on over the
// still-empty field and nothing fires, which is the "no catching up" half. A
// second destruction is the next qualifying event, and the clearing resumes
// there: the `waveclear` interstitial begins, exactly as specs/rings.md's
// clearing event states. That the switch OFF holds the clearing is
// `wave-advance-switch-holds`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { shedDestruction } from "./shed";

/** Ticks the re-armed but eventless field is watched. */
const WATCH_TICKS = 40;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires on the next destruction and not on the one it missed", async () => {
  await isolate(h);

  const missed = await shedDestruction(h, 0);
  await h.debug.clearBalls();

  await h.debug.setWaveAdvance(true);
  const armed = await h.tick(WATCH_TICKS);
  assertEqual(armed.screen, "playing", "the screen after re-arming the switch");
  assertEqual(armed.wave, 1, "the wave after re-arming the switch");

  const cleared = await captureReplay(h, "resumed", () =>
    shedDestruction(h, 3),
  );
  assertEqual(cleared.screen, "waveclear", "the screen on the next event");
  assertGreaterThan(
    cleared.score,
    missed.score,
    "the clearing destruction's own scoring",
  );
});
