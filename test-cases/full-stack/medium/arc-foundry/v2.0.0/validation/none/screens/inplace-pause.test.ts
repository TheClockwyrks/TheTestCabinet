// screens/inplace-pause — the in-place pause freezes the yard without a menu.
//
// THE REQUIREMENT. `specs/ui.md`, of `playing`: "The game can be paused in place
// here: the simulation freezes, the yard stays visible with no menu over it, and
// the status bar reads `PAUSED`." `specs/controls.md` says what freezing means
// for the clock: paused in place, the simulation clock "advances by nothing", and
// every duration and every rate in the specification is measured against that
// clock. `specs/instrumentation.md` reports the pause as `paused` with the screen
// staying `playing`, and says that `menuButtons` "returns an empty array on any
// screen that is not a menu, which includes `playing` under an in-place pause".
//
// HOW IT IS DECIDED. A wave is opened with three units walking the chain — really
// walking, not held, because what the pause has to stop is the game's own
// movement — and they are given a second of simulation so that none of them is
// still standing on the entry. The pause is then engaged, and ten seconds of
// simulation are driven through it. Three things are read afterwards: the
// simulation clock has not moved, every unit is exactly where it stood, and the
// screen still reads `playing` with no menu over it.
//
// TEN SECONDS IS THE SPAN THE ITEM NAMES, and it is long enough that the slowest
// thing on the yard would have crossed several tiles if the freeze had leaked.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  ConstantClock,
  createHarness,
  openYard,
  releaseUnit,
  unitById,
  type Harness,
} from "../harness";

/**
 * The frame rate this check is driven at: `10` Hz, a twelfth of this project's
 * default.
 *
 * The frozen span reads three things that must not move — the simulation clock and
 * each unit's `x` and `y` — and a frozen unit does not move whatever the step is.
 * The settling second before it only has to get each unit off the entry, which one
 * second of travel does at any division of it. `specs/instrumentation.md` fixes no
 * frame size and guarantees an interval of simulation time reaches the same state
 * however it was divided into frames, which
 * `instrumentation/frame-division-movement` and
 * `instrumentation/frame-division-projectile` are the two items that decide. Both
 * spans are stated in SECONDS and both are unchanged; only the frames they are
 * divided into are fewer.
 */
const PAUSE_HZ = 10;

/** Frames of that clock covering `s` seconds of simulation, rounded up. */
function pauseFrames(seconds: number): number {
  return Math.ceil(seconds * PAUSE_HZ);
}

/** How long the units walk before the pause is engaged. */
const SETTLE_SECONDS = 1;

/** How long the frozen yard is watched for. */
const FROZEN_SECONDS = 10;

/** The Load released onto the chain, unheld and walking. */
const RELEASED = ["mote", "spark", "filament"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(1000 / PAUSE_HZ) });
});

afterEach(async () => {
  await h.dispose();
});

it("holds the clock and every unit still, with no menu over the yard", async () => {
  await openYard(h, { wave: 6, integrity: 10_000 });
  const ids: number[] = [];
  for (const type of RELEASED) ids.push(await releaseUnit(h, type));
  await h.advance(pauseFrames(SETTLE_SECONDS));

  await h.debug.setPaused(true);
  const frozen = await h.snapshot();
  assertEqual(
    frozen.paused,
    true,
    "the in-place pause engaged before the frozen span is driven " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    frozen.screen,
    "playing",
    "the screen under an in-place pause, which opens no menu (specs/ui.md)",
  );

  await captureReplay(h, "paused", () =>
    h.advance(pauseFrames(FROZEN_SECONDS)),
  );

  const after = await h.snapshot();
  assertEqual(
    after.simTime,
    frozen.simTime,
    "the simulation clock across ten seconds of frames under an in-place " +
      "pause, which advances by nothing (specs/controls.md)",
  );
  for (const id of ids) {
    const was = unitById(frozen, id);
    const now = unitById(after, id);
    assertEqual(
      now.x,
      was.x,
      `unit #${id}'s x across ten seconds of frames under an in-place pause, ` +
        "which freezes the simulation (specs/ui.md)",
    );
    assertEqual(
      now.y,
      was.y,
      `unit #${id}'s y across ten seconds of frames under an in-place pause, ` +
        "which freezes the simulation (specs/ui.md)",
    );
  }

  assertEqual(
    after.screen,
    "playing",
    "the screen after ten seconds of in-place pause (specs/ui.md)",
  );
  assertLength(
    await h.debug.menuButtons(),
    0,
    "the menu choices drawn over a yard under an in-place pause, which is not " +
      "a menu screen (specs/instrumentation.md)",
  );
});
