// Deepcore — the page the showcase is captured from.
//
// The game's own entry point publishes nothing, which is right for a build that
// is played rather than driven. This page is the capture rig instead: it stands
// the same game up on the same engine, over a clock of its own so a capture is
// frame-exact, drives it with the same key events a player's keyboard sends, and
// hands back the engine's own recording of the frames it drew.
//
// It is served by the dev server and driven by `scripts/capture-showcase.mjs`.
// Nothing here is bundled into `dist/`.

import { ConstantClock, createEngine } from "@test-cabinet/simple-2d";
import { STAGE_H, STAGE_W } from "../../src/constants";
import { BACKGROUND, game } from "../../src/game";

const FRAME_MS = 1000 / 60;

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

const hold = async (code: string, frames: number): Promise<void> => {
  key("keydown", code);
  await engine.advance(frames);
  key("keyup", code);
  await engine.advance(1);
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
 * Run one expedition and hand back the media.
 *
 * The dig is driven entirely through the keyboard: nothing here poses an outcome
 * the play did not reach.
 */

(window as unknown as Record<string, unknown>).captureShowcase =
  async (): Promise<{ dig: string; stills: Record<string, string> }> => {
    await ready;
    const stills: Record<string, string> = {};

    // Through the menus into a Quick expedition.
    await engine.advance(30);
    await tap("Enter"); // NEW EXPEDITION
    await tap("Enter"); // STANDARD
    await tap("Enter"); // QUICK
    await engine.advance(30);
    stills.camp = still();

    // Walk east along the camp until a building answers, and look at what it
    // sells.
    for (let step = 0; step < 60 && engine.state.panel === null; step += 1) {
      await hold("KeyD", 10);
      key("keydown", "KeyE");
      key("keyup", "KeyE");
      await engine.advance(2);
    }
    if (engine.state.panel !== null) stills.pad = still();
    await tap("Escape");

    // The dig, recorded: bore down through the topsoil and into the rockbed,
    // then jetpack back toward the surface.
    engine.startRecording();
    await hold("KeyS", 480);
    stills.shaft = still();
    await hold("KeyW", 150);
    await engine.advance(20);
    const dig = await pack(engine.stopRecording());

    // The haul, in the bag the player drops ore from.
    await tap("KeyI");
    await engine.advance(10);
    stills.hold = still();

    return { dig, stills };
  };
