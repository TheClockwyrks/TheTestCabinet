// Wick — instrumentation/poses-sound-nothing: `setScreen("playing")`,
// `setHp(1)`, `spawnEnemy`, `spawnPickup("chest", ...)`, and `choose` each
// play no cue at the call, and the frame after `setScreen("playing")` has
// `music` looping exactly as a run started from the menu would one frame
// later.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md): "A pose changes
// the state alone and sounds nothing; the cues a scenario hears come from the
// ticks and frames run after it. The two looping cues are reconciled from the
// state by the next frame, so a run posed through `setScreen("playing")`
// sounds exactly as one started from the menu one frame later."
// specs/ui.md: "`music` is looping on every frame exactly when `screen` is
// `playing` ...". `setScreen`: "No cue sounds at the call."; `choose`:
// "Sounds nothing."
//
// WHY THE WORLD IS POSED AS IT IS. The probe logs every sound the build emits,
// so each pose is bracketed by a read of its log taken inside the page, in the
// same evaluation as the call: the same document leaves the build's own loop
// running in real time while the clock is held, and a frame of that loop
// reconciles the loops, so a read taken across two crossings would hear the
// frame after the pose as well as the pose. `choose` accepts an offer, and the
// offers are drawn by the tick that opens the overlay rather than by the pose
// that sets the screen, so that one is made on an isolated night whose overlay
// was opened the real way; the two routes into play are compared on the loop
// they leave running.
//
// AND WHY THE FRAME AFTER EACH POSE IS READ TOO. The bracket alone decides only
// what sounded INSIDE the call. A build that queues the transition's cue rather
// than discarding it sounds nothing at the call and plays it on the very next
// frame, which is a pose sounding by another route: "A cue is played by a tick
// or a frame, never by a pose of the debug surface" (specs/ui.md). So each pose
// takes a second reading, opened before the call and closed after a frame that
// consumes NO tick — `advance(TICK_DT / 4)`, which "poses a partial frame" and
// on `playing` leaves the delta waiting in the accumulator
// (specs/instrumentation.md) — and requires that stretch to carry no one-shot
// cue. A frame that ticks nothing can raise no cue of its own, so anything
// heard there was the pose's. The delta is a thousandth of a tick, so the
// deltas of every pose in the check together still leave the accumulator far
// short of `TICK_DT` and no tick ever runs under them.
//
// THE TWO LOOPS ARE EXEMPT, BY THE SPECIFICATION. "The two looping cues are
// reconciled from the state by the next frame, so a run posed through
// `setScreen("playing")` sounds exactly as one started from the menu one frame
// later", so the second reading counts one-shot sounds alone: the frame after
// `setScreen("playing")` is required to start `music`, not to stay silent, and
// that requirement is the reading at the foot of this check.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TICK_DT } from "../constants";
import {
  advanceBy,
  bracket,
  captureStill,
  createHarness,
  isLooping,
  isolate,
  openLevelUp,
  soundCount,
  soundsSince,
  startRunFromTitle,
  type Harness,
  type WickDebugApi,
} from "../harness";

/**
 * The delta the frame after each pose is run with: a thousandth of a tick, so
 * the frame runs and consumes no tick and can raise no cue of its own. The
 * deltas of the whole check accumulate on `playing`, so the figure is small
 * enough that every frame this check runs together stays far inside one tick.
 */
const QUIET_DELTA = TICK_DT / 1000;

let h: Harness;

beforeEach(async () => {
  // ARMED, because every reading here is a silence: a page that was handed no
  // gesture sounds nothing whatever the poses do, and each of them would pass.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Make the call, and read what sounded at it and on the tickless frame after
 * it: nothing at all inside the call, and no one-shot cue across the pose and
 * that frame together.
 */
async function requireSilent(
  name: string,
  op: keyof WickDebugApi,
  ...args: readonly unknown[]
): Promise<void> {
  const from = await soundCount(h);
  const { sounds } = await bracket(h, op, args);
  assertLength(sounds, 0, `sounds played at ${name}`);

  await advanceBy(h, QUIET_DELTA);
  const heard = (await soundsSince(h, from)).filter((sound) => !sound.loop);
  assertLength(
    heard.map((sound) => sound.name),
    0,
    `one-shot cues sounded at ${name} or on the tickless frame after it`,
  );
}

it("plays no cue at a pose, and reconciles the loops on the next frame", async () => {
  await h.debug.reset();
  await requireSilent("setScreen('playing')", "setScreen", "playing");
  await requireSilent("setHp(1)", "setHp", 1);
  await requireSilent(
    "spawnEnemy('moth', 300, 0)",
    "spawnEnemy",
    "moth",
    300,
    0,
  );
  await requireSilent(
    "spawnPickup('chest', 0, 0)",
    "spawnPickup",
    "chest",
    0,
    0,
  );
  await h.debug.setPendingLevelUps(1);
  await requireSilent("setScreen('levelup')", "setScreen", "levelup");

  // `choose` accepts one of the overlay's offers, which the tick that opens it
  // draws; the pose sets the screen alone, so the overlay is opened the real
  // way on a night with nothing else in it.
  await isolate(h);
  const overlay = await openLevelUp(h);
  assertEqual(overlay.screen, "levelup", "the overlay choose is made on");
  await requireSilent("choose(0)", "choose", 0);

  // The posed route: music is looping one frame after `setScreen("playing")`.
  await h.debug.reset();
  await h.step(1);
  assertEqual(await isLooping(h, "music"), false, "music on the title");
  await h.debug.setScreen("playing");
  await h.step(1);
  await captureStill(h, "silent");
  assertEqual(
    await isLooping(h, "music"),
    true,
    "music one frame after setScreen('playing')",
  );

  // The played route: the same one frame later.
  await startRunFromTitle(h);
  assertEqual(
    await isLooping(h, "music"),
    true,
    "music one frame after LIGHT THE LAMP",
  );
});
