// Arc Foundry — the device input layer (specs/controls.md).
//
// This game stands on no engine, so the pointer and the keyboard belong to the runtime
// layer written here. The layer's whole job is to take the cursor and the keys off the page
// and deliver them to the game in the game's own terms: a pointer position in logical units
// on the 1280 x 720 stage with its press and release edges, and a `KeyboardEvent.code` per
// key edge.
//
// Each act is delivered IMMEDIATELY, as the browser reports it, rather than queued for the
// next update. That is what makes a player's press and a posed press the same event to the
// game (specs/instrumentation.md): both arrive down the callbacks below.

export interface InputHandlers {
  pointerMove(x: number, y: number): void;
  pointerDown(x: number, y: number): void;
  pointerUp(): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
}

export class Input {
  private scale = 1;
  private offX = 0;
  private offY = 0;

  constructor(private readonly on: InputHandlers) {}

  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointermove", (e) => {
      const p = this.toLogical(e.clientX, e.clientY);
      this.on.pointerMove(p.x, p.y);
    });
    canvas.addEventListener("pointerdown", (e) => {
      const p = this.toLogical(e.clientX, e.clientY);
      this.on.pointerDown(p.x, p.y);
    });
    window.addEventListener("pointerup", () => this.on.pointerUp());
    window.addEventListener("keydown", (e) => {
      // Keep the page from scrolling on Space and the arrows while playing.
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown")
        e.preventDefault();
      // A key held down repeats; the game reads press EDGES, so a repeat arms nothing.
      if (e.repeat) return;
      this.on.keyDown(e.code);
    });
    window.addEventListener("keyup", (e) => this.on.keyUp(e.code));
  }

  // The letterbox fit the frame loop computed, so a client position maps onto the stage.
  setViewport(scale: number, offX: number, offY: number): void {
    this.scale = scale;
    this.offX = offX;
    this.offY = offY;
  }

  toLogical(clientX: number, clientY: number): { x: number; y: number } {
    return {
      x: (clientX - this.offX) / this.scale,
      y: (clientY - this.offY) / this.scale,
    };
  }
}
