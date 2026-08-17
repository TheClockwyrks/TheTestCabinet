// Cascade — pointer input (mouse and touch).
//
// The game is played with a mouse or a touchscreen. Pointer events unify both, so
// they are translated from client pixels into the fixed 1280x720 logical space and
// routed to the Game; a double-click / double-tap drives the auto-move to a
// foundation. The canvas sets `touch-action: none` so a touch drag never scrolls or
// zooms the page.

import { FIELD_H, FIELD_W } from "./constants";
import type { Game } from "./game";

export function attachInput(canvas: HTMLCanvasElement, game: Game): void {
  // Client pixel → logical stage coordinate.
  function toLogical(e: { clientX: number; clientY: number }): {
    x: number;
    y: number;
  } {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * FIELD_W;
    const y = ((e.clientY - rect.top) / rect.height) * FIELD_H;
    return { x, y };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = toLogical(e);
    game.pressAt(x, y);
  });

  canvas.addEventListener("pointermove", (e) => {
    const { x, y } = toLogical(e);
    game.moveTo(x, y);
  });

  const endPointer = (e: PointerEvent): void => {
    const { x, y } = toLogical(e);
    game.releaseAt(x, y);
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener("dblclick", (e) => {
    const { x, y } = toLogical(e);
    game.doubleClickAt(x, y);
  });

  // Suppress the browser context menu so a right-click never interrupts play.
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // The backtick key toggles the read-only debug overlay (specs/instrumentation.md).
  // It only draws diagnostics and never affects gameplay.
  window.addEventListener("keydown", (e) => {
    if (e.code === "Backquote") {
      game.debugOverlay = !game.debugOverlay;
      e.preventDefault();
    }
  });
}
