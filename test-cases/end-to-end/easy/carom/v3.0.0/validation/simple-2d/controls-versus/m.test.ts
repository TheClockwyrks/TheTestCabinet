// Carom — controls-versus/m: pressing `M` toggles mute.
//
// Mute is bound to the runtime's `mute` action (specs/modes/versus.md) and the
// bus it silences is the ENGINE's: the game implements no muting of its own, it
// toggles the runtime's from that action and mirrors the bit into
// `CaromState.muted`, which is what `snapshot()` reports (specs/ui.md,
// specs/instrumentation.md). The mute key works on any screen, so this drives it
// from the title, where mute starts off — and it is the same key on the same
// action in both ways to play, so this check reads the same in Versus as in
// the other.
//
// Two things are asserted, because the reported bit alone is only half of it.
// The flag flips, and flips back — it is a toggle, not a latch. And the runtime's
// bus really is silenced: a cue played while muted is still announced, at a gain
// of zero, so a build that flipped a boolean of its own and left the bus running
// is told apart from one that muted the runtime.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  arrangeLiveBall,
  captureStill,
  createHarness,
  watchCues,
  type Harness,
} from "../harness";
import { FIELD_CX } from "../../src/constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("flips the reported mute bit on, and off again", async () => {
  await h.advance(1); // paint the title, so the mirrored bit is a fresh read
  expect(h.snapshot().screen).toBe("title");
  expect(h.snapshot().muted).toBe(false);

  await h.tap("KeyM");
  captureStill(h, "mute");
  expect(h.snapshot().muted).toBe(true);

  await h.tap("KeyM");
  expect(h.snapshot().muted).toBe(false);
});

it("silences the runtime's cue bus while it is on", async () => {
  await h.advance(1);
  await h.tap("KeyM");
  expect(h.snapshot().muted).toBe(true);

  // Straight up into the top wall, which is the shortest real event that plays a
  // cue. Muting survives a `reset`, so the drive below is still muted.
  const played = watchCues(h);
  await arrangeLiveBall(h, { x: FIELD_CX, y: 80, vx: 0, vy: -500 });
  const bounced = await h.until((s) => s.ball.vy > 0, { maxFrames: 120 });

  expect(bounced.hit).toBe(true);
  expect(h.snapshot().muted).toBe(true);
  for (const cue of played) expect(cue.gain).toBe(0);
});
