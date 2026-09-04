// Refract — audio/pointer: raising a pointer event the way a PLAYER raises it.
//
// PRIVATE TO THIS CATEGORY. The shared harness poses the pointer through the
// debug surface (`pressCell`, `moveToCell`, `debug.trace`), which
// specs/instrumentation.md says resolves "against the live state before the
// call returns rather than deferred to the next frame". That is exactly right
// for arranging a board, and wrong for pinning a CUE: specs/ui.md fixes each
// cue as played "on the frame its event happens", by the code that raised it,
// and an event resolved between frames has no frame to be played on. A build
// that plays nothing for a debug-posed segment is conformant.
//
// So every audio check raises its own event the way the player does. For this
// engine that is a real pointer sample: the engine's input system listens for
// `pointerdown`/`pointermove`/`pointerup` on the target the surface hands it
// (the engine's `engine/` docs), lists the samples it received, and the game's
// player controller reads that list inside its update. The helpers below
// dispatch those events and then run the ONE frame that delivers them, so the
// frame a cue must play on is the frame this function advanced — and nothing
// about the game's own resolution is bypassed: the hit radius, the grab rules,
// and every limit run as they do for a player.
//
// Positions. The input system reads `clientX`/`clientY` as CSS pixels from the
// canvas's top-left corner and maps them through the live viewport fit, which
// is the inverse of the harness's own `device`. `device` answers in the
// canvas's backing store, so the client position is that point divided by the
// device pixel ratio — recovered from the canvas the harness built rather than
// assumed, so a check that builds its harness at some other ratio is still
// pointing where it means to.

import { STAGE_W } from "../notation";
import { centerOf, type CellRef, type Harness } from "../harness";

/**
 * A `PointerEvent`-shaped event: the engine's input system reads `clientX`,
 * `clientY`, and `isPrimary`, structurally, so this drives it exactly as a
 * browser's own event does.
 */
class PointerLikeEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    clientX: number,
    clientY: number,
  ) {
    super(type);
    this.clientX = clientX;
    this.clientY = clientY;
  }
}

/** Device pixels per CSS pixel, as the harness's canvas reports it. */
function ratioOf(h: Harness): number {
  const ratio = h.canvas.width / STAGE_W;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/** A logical stage point as the client position that lands on it. */
function clientOf(h: Harness, x: number, y: number): { x: number; y: number } {
  const point = h.device(x, y);
  const ratio = ratioOf(h);
  return { x: point.x / ratio, y: point.y / ratio };
}

function dispatch(
  h: Harness,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): void {
  const client = clientOf(h, x, y);
  h.events.dispatchEvent(new PointerLikeEvent(type, client.x, client.y));
}

/**
 * Press at `cell`'s center as a player's pointer does, then run the one frame
 * that delivers the sample to the game.
 */
export async function playerPress(h: Harness, cell: CellRef): Promise<void> {
  const { x, y } = centerOf(h, cell);
  dispatch(h, "pointerdown", x, y);
  await h.advance(1);
}

/**
 * Move the held pointer to `cell`'s center as a player's pointer does, then
 * run the one frame that delivers the sample — the frame whatever the move
 * raises happens on.
 */
export async function playerMoveTo(h: Harness, cell: CellRef): Promise<void> {
  const { x, y } = centerOf(h, cell);
  dispatch(h, "pointermove", x, y);
  await h.advance(1);
}

/**
 * Release at the pointer's last cell as a player's pointer does, then run the
 * one frame that delivers the sample.
 */
export async function playerRelease(h: Harness, cell: CellRef): Promise<void> {
  const { x, y } = centerOf(h, cell);
  dispatch(h, "pointerup", x, y);
  await h.advance(1);
}

/**
 * Draw `cells` end to end the way a player draws them: a press on the first,
 * a move to each of the rest, and a release on the last — every sample real,
 * every one delivered by its own frame.
 */
export async function playerDraw(
  h: Harness,
  cells: readonly CellRef[],
): Promise<void> {
  const [first, ...rest] = cells;
  if (first === undefined) return;
  await playerPress(h, first);
  for (const cell of rest) await playerMoveTo(h, cell);
  await playerRelease(h, cells[cells.length - 1]);
}
