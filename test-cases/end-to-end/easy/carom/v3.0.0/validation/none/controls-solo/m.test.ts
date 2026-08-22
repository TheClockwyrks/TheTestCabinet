// Carom — controls-solo/m: pressing `M` toggles mute.
//
// Mute is bound to the `mute` action (specs/modes/single-player.md) and the bit it
// flips is the RUNTIME's — which an engineless build wrote itself, so both halves
// are the build's here: the audio layer that owns the bit, and the game that
// binds the action to it and mirrors the bit into its own state every frame so
// `snapshot().muted` reports it (specs/ui.md, specs/instrumentation.md). The mute
// key works on any screen, so this drives it from the title, where mute starts
// off — and it is the same key on the same action in both ways to play, so this
// check reads the same in Solo as in the other.
//
// THE KEY IS A REAL ONE. `h.tap` presses through Chromium's own input pipeline,
// so what reaches the build is a genuine DOM key event and the whole path from
// the physical key to the flipped bit is exercised.
//
// WHAT IS ASSERTED, AND WHAT A REVIEWER IS LEFT. Three things, and each is
// something the specification fixes. The bit flips, and flips BACK — it is a
// toggle, not a latch. It survives a `reset()`, which specs/instrumentation.md
// singles out: muting is a player preference the runtime owns and resetting the
// game must not silently un-mute it. And the game stays fully playable while it
// is on (specs/ui.md), which a real wall bounce driven under mute establishes.
//
// What is NOT asserted is that the speakers went quiet, and that is deliberate
// rather than an oversight. Under an engine the bus announces every cue with its
// gain, so a build that flipped a boolean of its own and left the bus running is
// caught. There is no bus to ask here, and the two conformant ways to mute are
// indistinguishable from outside: a build may stop starting sources at all, or
// keep starting them at a gain of zero. Requiring either would fail a build for
// choosing the other, so whether mute is really silent is the reviewer's, by ear.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CX } from "../constants";
import {
  arrangeLiveBall,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips the reported mute bit on, and off again", async () => {
  await h.advance(1); // paint the title, so the mirrored bit is a fresh read
  const opened = await h.snapshot();
  expect(opened.screen).toBe("title");
  expect(opened.muted).toBe(false);

  await h.tap("KeyM");
  await captureStill(h, "mute");
  expect((await h.snapshot()).muted).toBe(true);

  await h.tap("KeyM");
  expect((await h.snapshot()).muted).toBe(false);
});

it("keeps the game playable, and the preference, while it is on", async () => {
  await h.advance(1);
  await h.tap("KeyM");
  expect((await h.snapshot()).muted).toBe(true);

  // Straight up into the top wall, which is the shortest real event that plays a
  // cue. `arrangeLiveBall` resets and restarts the game on its way, which is
  // exactly the point: muting is deliberately untouched by `reset()`
  // (specs/instrumentation.md), so a build that cleared it here would be
  // discarding a player preference the specification says it must keep.
  await arrangeLiveBall(h, { x: FIELD_CX, y: 80, vx: 0, vy: -500 });
  expect((await h.snapshot()).muted).toBe(true);

  const bounced = await h.until((s) => s.ball.vy > 0, { maxFrames: 120 });
  expect(bounced.hit).toBe(true);
  expect((await h.snapshot()).muted).toBe(true);
});
