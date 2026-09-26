// A stage-sized offscreen surface, for a host that has none.
//
// The painted layer the victory cascade leaves behind is a persistent offscreen
// canvas (`src/trail.ts`), which a browser supplies as `OffscreenCanvas` or as a
// `canvas` element. A Node process carries neither, and the build's own tests run
// in one, so this module stands both up over `@napi-rs/canvas`.
//
// It only ever fills an ABSENCE, so importing it in a browser displaces nothing,
// and it is imported before anything of the game's so the shim is in place before
// a frame can ask for a surface. It belongs to the test harness rather than to
// the game: nothing under `src/` outside the harness imports it.

import { createCanvas } from "@napi-rs/canvas";

const scope = globalThis as Record<string, unknown>;

if (!("OffscreenCanvas" in scope)) {
  scope.OffscreenCanvas = class {
    constructor(width: number, height: number) {
      return createCanvas(width, height) as unknown as object;
    }
  };
}

if (!("document" in scope)) {
  scope.document = {
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error(`Cascade: no element ${tag}`);
      return createCanvas(1, 1);
    },
  };
}

/** Whether both routes to an offscreen surface are now reachable. */
export function offscreenAvailable(): boolean {
  return "OffscreenCanvas" in scope && "document" in scope;
}
