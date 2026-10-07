// Arc Foundry — the device input layer (specs/controls.md).
//
// This game stands on no engine, so the pointer, the touch contact and the keyboard belong
// to the runtime layer written here. The layer's whole job is to take the cursor, the
// fingers and the keys off the page and deliver them to the game in the game's own terms: a
// pointer position in logical units on the 1280 x 720 stage with its press and release
// edges, a touch contact's landing, travel and lift in those same units, and a
// `KeyboardEvent.code` per key edge.
//
// Each act is delivered IMMEDIATELY, as the browser reports it, rather than queued for the
// next update. That is what makes a player's press and a posed press the same event to the
// game (specs/instrumentation.md): both arrive down the callbacks below.

export interface InputHandlers {
  pointerMove(x: number, y: number): void;
  pointerDown(x: number, y: number): void;
  pointerUp(): void;
  touchStart(x: number, y: number): void;
  touchMove(x: number, y: number): void;
  touchEnd(): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
}

export class Input {
  private scale = 1;
  private offX = 0;
  private offY = 0;

  constructor(private readonly on: InputHandlers) {}

  attach(canvas: HTMLCanvasElement): void {
    // A touch contact is delivered as a contact rather than as a pointer, so the two
    // paths are separated here: a `pointerType` of `touch` goes to the touch handlers
    // and everything else to the pointer's (specs/controls.md).
    canvas.addEventListener("pointermove", (e) => {
      const p = this.toLogical(e.clientX, e.clientY);
      if (e.pointerType === "touch") this.on.touchMove(p.x, p.y);
      else this.on.pointerMove(p.x, p.y);
    });
    canvas.addEventListener("pointerdown", (e) => {
      const p = this.toLogical(e.clientX, e.clientY);
      if (e.pointerType === "touch") this.on.touchStart(p.x, p.y);
      else this.on.pointerDown(p.x, p.y);
    });
    window.addEventListener("pointerup", (e) => {
      if (e.pointerType === "touch") this.on.touchEnd();
      else this.on.pointerUp();
    });
    window.addEventListener("pointercancel", (e) => {
      if (e.pointerType === "touch") this.on.touchEnd();
      else this.on.pointerUp();
    });
    // The page must not scroll or zoom under a contact driving the stage.
    canvas.style.touchAction = "none";
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
