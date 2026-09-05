// Kessler — the page the showcase is captured from (specs/showcase.md).
//
// The game's own entry point publishes nothing, which is right for a build
// that is played rather than driven. This page is the capture rig instead: it
// stands the same game up on the same engine, over a ConstantClock so a
// capture is frame-exact, and drives it with the same key events a player's
// keyboard sends. The one non-key touch is the debug surface's pure
// `snapshot` reading, which the tracking player steers by — every launch,
// bounce, catch, and destruction in the take was reached through play. It
// hands back the engine's own recording of the frames the build drew, plus
// stills of the same run.
//
// It is served by the dev server and driven by `scripts/capture-showcase.mjs`.
// Nothing here is bundled into `dist/`.

import { ConstantClock, createEngine } from "@clockwyrks/simple-2d";
import {
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_TURN_DEG_PER_SEC,
  STAGE_H,
  STAGE_W,
  TICK_DT,
} from "../../src/constants";
import { angularOffsetDeg, dot, polarOf, radialAt } from "../../src/polar";
import { BACKGROUND, game } from "../../src/game";

const FRAME_MS = 1000 / 60;
/** The deadband that stops the tracker oscillating, half a tick's turn. */
const TRACK_DEADBAND_DEG = (DEFLECTOR_TURN_DEG_PER_SEC * TICK_DT) / 2;

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const engine = createEngine({
  canvas,
  width: STAGE_W,
  height: STAGE_H,
  game,
  background: BACKGROUND,
  clock: new ConstantClock(FRAME_MS),
});

const ready = engine.initialize();

/** Dispatch a key event at the document, exactly as a keyboard does. */
function key(type: "keydown" | "keyup", code: string): void {
  document.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

const tap = async (code: string): Promise<void> => {
  key("keydown", code);
  key("keyup", code);
  await engine.advance(2);
};

/** The stage as a PNG data URL. */
const still = (): string => canvas.toDataURL("image/png");

/** A recording, gzipped and base64 encoded. */
async function pack(recording: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(recording));
  const gz = new Response(
    new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")),
  );
  const bytes = new Uint8Array(await gz.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Where a straight flight from `(x, y)` at `(vx, vy)` next crosses the
 * deflector contact radius, or `null` when the path misses it.
 */
function paddleCrossingAngle(
  x: number,
  y: number,
  vx: number,
  vy: number,
): { t: number; angleDeg: number } | null {
  const px = x - 500;
  const py = y - 500;
  const a = vx * vx + vy * vy;
  if (a === 0) return null;
  const b = 2 * (px * vx + py * vy);
  const c =
    px * px +
    py * py -
    DEFLECTOR_BALL_CONTACT_RADIUS * DEFLECTOR_BALL_CONTACT_RADIUS;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0) return null;
  return {
    t,
    angleDeg: polarOf(px + vx * t + 500, py + vy * t + 500).angleDeg,
  };
}

/** The keys the tracker holds right now, so each change is a real edge. */
const heldKeys = { left: false, right: false };

function setHeld(side: "left" | "right", down: boolean): void {
  if (heldKeys[side] === down) return;
  heldKeys[side] = down;
  key(down ? "keydown" : "keyup", side === "left" ? "ArrowLeft" : "ArrowRight");
}

/**
 * One frame of the tracking player: launch whatever sits parked, then steer
 * toward the soonest projected paddle crossing — or under the innermost ball
 * while every ball is outbound — with real held keys.
 */
function drive(): void {
  const snap = engine.debug.snapshot(engine.state);
  if (snap.screen !== "playing") return;
  if (snap.balls.some((ball) => ball.parked)) key("keydown", "Space");

  let target: number | null = null;
  let soonest = Infinity;
  let nearestR = Infinity;
  for (const ball of snap.balls) {
    if (ball.parked) continue;
    const cur = polarOf(ball.x, ball.y);
    if (cur.r < nearestR) {
      nearestR = cur.r;
      if (target === null) target = cur.angleDeg;
    }
    if (cur.r <= DEFLECTOR_BALL_CONTACT_RADIUS) continue;
    if (dot({ x: ball.vx, y: ball.vy }, radialAt(cur.angleDeg)) >= 0) continue;
    const crossing = paddleCrossingAngle(ball.x, ball.y, ball.vx, ball.vy);
    if (crossing && crossing.t < soonest) {
      soonest = crossing.t;
      target = crossing.angleDeg;
    }
  }
  if (target === null) {
    setHeld("left", false);
    setHeld("right", false);
    key("keyup", "Space");
    return;
  }
  const offset = angularOffsetDeg(target, snap.paddle.angleDeg);
  setHeld("right", offset > TRACK_DEADBAND_DEG);
  setHeld("left", offset < -TRACK_DEADBAND_DEG);
  key("keyup", "Space");
}

/** Run `frames` frames of tracked play, one advance per frame. */
async function play(frames: number): Promise<void> {
  for (let frame = 0; frame < frames; frame += 1) {
    drive();
    await engine.advance(1);
  }
}

/**
 * Run one session and hand back the media: the title, a sustained take of
 * live wave-1 play as the engine's own recording, a still from that take,
 * and the how-to page.
 */
(window as unknown as Record<string, unknown>).captureShowcase =
  async (): Promise<{ sweep: string; stills: Record<string, string> }> => {
    await ready;
    const stills: Record<string, string> = {};

    await engine.advance(40);
    stills.title = still();

    // The how-to, then back to the title.
    await tap("ArrowDown");
    await tap("Enter");
    await engine.advance(10);
    stills.howto = still();
    await tap("Escape");

    // START, settle a moment, then record a sustained take of real play.
    engine.apply((s) => engine.debug.reset(s, { seed: 3 }));
    await engine.advance(2);
    await tap("Space");
    await play(90);
    engine.startRecording();
    await play(14 * 60);
    stills.field = still();
    await play(14 * 60);
    const sweep = await pack(engine.stopRecording());

    return { sweep, stills };
  };
