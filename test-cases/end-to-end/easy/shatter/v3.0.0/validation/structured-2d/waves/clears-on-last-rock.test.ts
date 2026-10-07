// waves/clears-on-last-rock — destroying the last rock on the field turns the
// wave over on that tick.
//
// THE RULE. `specs/progression.md`, "Clearing a wave": "A wave clears on the tick
// in which the last rock on the field is destroyed. It is a transition, not a
// condition on the field", and "Destroying rocks is the only way a wave clears".
// `specs/progression.md`, "The banner": "On the tick a wave clears, the wave
// number advances by one and a `WAVE N` banner appears".
//
// WHAT IS MEASURED. `waveBanner` on the tick the field's last rock leaves the
// roster, having been DESTROYED by one of the ship's own rounds. Nothing else:
// the NUMBER the banner announces is `wave-number-increments`'s point, how long
// it runs is `banner-runs-for-1p5s`'s, what the field does under it is
// `no-rock-during-the-banner`'s and `spawns-as-the-banner-ends`'s, and the
// negative direction — an emptied field that was never shot down — is
// `an-empty-field-does-not-clear-by-itself`'s. A build that clears on the wrong
// event misses one point per requirement rather than five per defect.
//
// THE CLEAR IS A REAL KILL, AND THAT IS THE REPAIR THIS ITEM CARRIES. The
// previous version of this case reached its cleared wave by calling
// `clearRocks()`, which `specs/instrumentation.md` defines as a way to make room
// that "destroys nothing and scores nothing, so a field it emptied has had no
// rock destroyed on that tick". A build that raises its next wave from the
// destruction rather than from polling an empty field is exactly conformant and
// failed that check. Here the last rock is taken down by a round placed on its
// doorstep and resolved by the build's own collision code (`./scene.ts`), so both
// kinds of build reach the banner and only a build that never raises one fails.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that never
// clears at all reports `waveBanner` 0 for the whole window. A build that clears
// on an empty PREDICATE rather than on the destruction passes this check and
// fails `an-empty-field-does-not-clear-by-itself`, so the pair names which of the
// two it is. A build that clears a tick late is inside the one-tick allowance
// below; a build that clears half a second late is not.
//
// THE POSE. `openWaveAt` is the harness's quiet ground with exactly one gate
// turned back on — `setWaveSpawning(true)`, the faculty this item decides. The
// saucer's arrival and the ship's lethal contact stay off, and the field holds
// nothing but the one Small the check destroys, so the tick that rock leaves the
// roster is the only event in the window.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { clearTheWave, openWaveAt } from "./scene";

/** The wave the field is posed at. Any wave clears the same way. */
const WAVE = 4;

/**
 * How many ticks after the kill the banner may go up.
 *
 * ONE. `specs/simulation.md` fixes the six steps inside a tick and puts collision
 * resolution last; it does not say where the wave loop's own notice of the
 * destruction sits among them. A build that resolves the hit and raises the
 * banner in the same pass reads on the tick of the kill; a build that notices at
 * the top of the next tick reads one tick later. Both are the tick the
 * specification names to within the resolution the specification fixes, and a
 * build that is slower than that is not.
 */
const BANNER_LATE_TICKS = 1;

/**
 * How long the recording runs on past the kill: a second of the banner standing
 * over the emptied field.
 *
 * The verdict is still read at the instant of the kill. A clip that cut on the
 * frame of the measurement would show the reviewer the round landing and none of
 * the thing the item is named for.
 */
const AFTERMATH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the banner on the tick the last rock is destroyed", async () => {
  openWaveAt(h, WAVE);

  const opened = h.snapshot();
  assertEqual(
    opened.waveBanner,
    0,
    "no banner showing before the clear, so the one read after it is the one " +
      "the clear raised (specs/instrumentation.md: setWaveBanner)",
  );
  assertEqual(
    opened.waveSpawning,
    true,
    "the game's own wave loop running, which is the faculty this item " +
      "decides (specs/instrumentation.md: setWaveSpawning)",
  );

  const run = await captureReplay(h, "clear", async () => {
    const kill = await clearTheWave(h);
    // The tick after the kill, read before anything else runs: the whole of the
    // allowance below.
    await h.advance(BANNER_LATE_TICKS);
    const late = h.snapshot();
    // The banner standing over the emptied field, for the reviewer.
    await h.advance(AFTERMATH_TICKS);
    return { kill, late };
  });
  const kill = run.kill;

  // The reading rests on the round having taken the LAST rock down: one rock on
  // the field on the tick before it landed, and that rock gone on the tick it
  // did — which is what `killTheLastRock` returns on.
  //
  // WHAT IS DELIBERATELY NOT ASSERTED IS THAT THE FIELD IS EMPTY AFTERWARDS. A
  // build that raises the banner correctly and then spawns its next wave on the
  // same tick rather than at the end of the banner holds rocks here, and it is
  // `no-rock-during-the-banner` that decides that defect. Reading it here too
  // would take three points off one build for one fault.
  assertLength(
    kill.before.rocks,
    1,
    "exactly one rock on the field on the tick before the fatal round lands, " +
      "so the rock it destroys is the last one (specs/progression.md)",
  );

  // The banner on the tick of the kill, or on the tick after it.
  const banner = Math.max(kill.at.waveBanner, run.late.waveBanner);

  assertGreaterThan(
    banner,
    0,
    `a WAVE N banner showing on the tick the last rock on the field is ` +
      `destroyed — a wave clears on that transition, and destroying rocks is ` +
      `the only way it clears (specs/progression.md); the round was placed on ` +
      `the rock's doorstep and resolved by the build's own collision code, ` +
      `never by clearRocks`,
  );
});
