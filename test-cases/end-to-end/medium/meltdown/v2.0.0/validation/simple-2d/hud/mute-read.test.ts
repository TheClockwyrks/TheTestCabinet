// hud/mute-read — the mute control reads plainly differently muted and unmuted,
// and its read changes on the frame the mute state does.
//
// THE RULE. specs/hud.md, The wave controls: "The mute control reads plainly
// differently muted and unmuted, and its read changes on the frame the mute state
// does, whichever way it was changed."
//
// THE STATE IS DRIVEN THROUGH THE KEY, BECAUSE THERE IS NOTHING ELSE TO DRIVE IT
// WITH. specs/instrumentation.md carries no `setMuted`: "`muted` is the game's
// copy of the runtime's mute bit... No operation sets it; the `mute` action and
// the panel's mute control do." So this check presses `KeyM`, which
// specs/controls.md binds `mute` to. That the CONTROL ITSELF toggles mute is
// `controls.mute-control`'s requirement and is deliberately not exercised here:
// this point is about what the control READS, and driving it by pressing it would
// make a build whose control does not work fail two items for one fault.
//
// THE OPENING STATE IS READ, NOT ASSUMED. Nothing in the specification fixes
// which way the bit stands when a game opens, and `reset` leaves it "exactly as
// it stands, because muting is a player preference the runtime owns"
// (specs/instrumentation.md). So both readings below are relative to whatever the
// build opened on, and a build that starts muted and one that starts unmuted are
// both conformant.
//
// "ON THE FRAME THE STATE DOES" IS WHAT THE SWEEP MEASURES. The check finds the
// FIRST frame on which `snapshot().muted` differs from the opening bit, and the
// control must already read differently on THAT frame — not on the next one.
// Both readings come from one frame each: the pixels are the canvas that frame
// left behind and the bit is the state that frame ended with, so the pair cannot
// straddle a frame boundary. The sweep is bounded at {@link SETTLE_FRAMES},
// which is generous enough for a build that mirrors the runtime's bit before it
// handles input and one that mirrors it after (specs/instrumentation.md says the
// copy is "refreshed in every update" and is not read at the call).
//
// THE READING IS PIXELS, BECAUSE THE PALETTE AND THE WORDS ARE THE BUILD'S.
// specs/overview.md fixes no colour and no typeface and specs/hud.md fixes no
// copy for this control, so the check samples the control's own rectangle — the
// one the build reported for it — in both states and asks how far the paint
// moved. A build that swaps a word, an icon, a colour or a whole crossed-out
// speaker all clear it; only one that paints the two states the same does not.
//
// THE CONTROL IS THE RECTANGLE THE BUILD REPORTED, which is what lets specs/hud.md
// require a mute control without fixing where it sits
// (specs/instrumentation.md, `controls`).

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import { largestChange, sampleRect } from "./read";

/** The key specs/controls.md binds `mute` to, and the only one. */
const KEY = BINDINGS.mute[0];

/**
 * How far the two readings of the control must sit apart, out of the 441 the RGB
 * cube spans.
 *
 * The suite's figure for "plainly apart" (specs/overview.md), the same one the
 * `presentation` group holds a tower against the floor and a tripped tower
 * against an online one to. 60 is about a seventh of the scale: a shade a player
 * reads as a different state rather than as a different rendering of the same
 * one.
 */
const APART_MIN = 60;

/**
 * How many frames past the press the bit is waited for.
 *
 * `h.tap` runs the one frame that delivers the press edge, and the snapshot's
 * `muted` is the game's COPY of the runtime's bit, refreshed in every update
 * (specs/instrumentation.md), so a build that refreshes its copy before it
 * handles input needs one more frame than one that refreshes after. Two spare
 * frames covers both and any handover a runtime puts between them.
 */
const SETTLE_FRAMES = 2;

/** How finely the control is sampled: a grid over its interior, dense enough
 * that a build which marks the state on a glyph alone has a sample land on it. */
const SAMPLE_COLS = 16;
const SAMPLE_ROWS = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the mute control apart on the frame the mute state changes", async () => {
  startRun(h);
  await drawFrame(h);

  const control = h.snapshot().controls.mute;
  const opened = h.snapshot().muted;
  const before: Rgb[] = sampleRect(h, control, SAMPLE_COLS, SAMPLE_ROWS);
  captureStill(h, "unmuted");

  await h.tap(KEY);
  let flipped = h.snapshot().muted !== opened;
  for (let frame = 0; frame < SETTLE_FRAMES && !flipped; frame += 1) {
    await drawFrame(h);
    flipped = h.snapshot().muted !== opened;
  }
  if (!flipped) {
    fail(
      `the muted bit to move within ${SETTLE_FRAMES} frames of a ${KEY} ` +
        `press, which is the only way this suite can change it ` +
        `(specs/controls.md, The actions; specs/instrumentation.md)`,
      `it stayed ${String(opened)}`,
    );
  }

  const after: Rgb[] = sampleRect(h, control, SAMPLE_COLS, SAMPLE_ROWS);
  captureStill(h, "muted");

  assertGreaterThanOrEqual(
    largestChange(before, after),
    APART_MIN,
    `how far the mute control's paint moved, out of 441, on the very frame ` +
      `the muted bit went from ${String(opened)} to ${String(!opened)} — ` +
      `specs/hud.md has it reading "plainly differently muted and unmuted", ` +
      `and changing "on the frame the mute state does"`,
  );
});
