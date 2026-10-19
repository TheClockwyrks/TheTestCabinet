// Carom — controls-solo/m: pressing `M` toggles mute.
//
// Mute is bound to the runtime's `mute` action (specs/modes/single-player.md) and the
// bus it silences is the ENGINE's: the game implements no muting of its own, it
// toggles the runtime's from that action, and the `muted` a `snapshot()`
// reports is a live read of that same bus's mute bit at the call (specs/ui.md,
// specs/instrumentation.md). The mute key works on any screen, so this drives it
// from the title, where mute starts off — and it is the same key on the same
// action in both ways to play, so this check reads the same in Solo as in
// the other.
//
// Two things are asserted, because the reported bit alone is only half of it.
// The flag flips, and flips back — it is a toggle, not a latch. And the runtime's
// bus really is silenced: a cue played while muted is still announced, at a gain
// of zero, so a build that flipped a boolean of its own and left the bus running
// is told apart from one that muted the runtime.
//
// THE FIELD THE SECOND CHECK DRIVES HOLDS ONE BALL AND NOTHING ELSE.
// `arrangeLiveBall` clears it and spawns that ball back, aimed straight up into
// the top wall with both paddles held out of the way, so every cue the record
// below carries belongs to the one bounce this check staged — an obstacle left
// standing could sound a cue of its own, and a cue at full gain is what the
// assertion is looking for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  arrangeLiveBall,
  ball0,
  captureStill,
  createHarness,
  watchCues,
  type Harness,
} from "../harness";
import { FIELD_CX } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips the reported mute bit on, and off again", async () => {
  await h.advance(1); // paint the title, so the still below has a frame to show
  assertEqual(h.snapshot().screen, "title");
  assertEqual(h.snapshot().muted, false);

  await h.tap("KeyM");
  captureStill(h, "mute");
  assertEqual(h.snapshot().muted, true);

  await h.tap("KeyM");
  assertEqual(h.snapshot().muted, false);
});

it("silences the runtime's cue bus while it is on", async () => {
  await h.advance(1);
  await h.tap("KeyM");
  assertEqual(h.snapshot().muted, true);

  // Straight up into the top wall, which is the shortest real event that plays a
  // cue. Muting survives a `reset`, so the drive below is still muted.
  const played = watchCues(h);
  await arrangeLiveBall(h, { x: FIELD_CX, y: 80, vx: 0, vy: -500 });
  const bounced = await h.until((s) => ball0(s).vy > 0, { maxFrames: 120 });

  assertEqual(bounced.hit, true);
  assertEqual(h.snapshot().muted, true);
  for (const cue of played) assertEqual(cue.gain, 0);
});
