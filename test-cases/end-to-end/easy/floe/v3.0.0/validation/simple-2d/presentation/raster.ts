// presentation — one frame's pixels, read back in logical units.
//
// Five points in this group read what the build actually PAINTED rather than
// what it called: the two "reads apart" points, the submerged bear, the HUD's
// bay marks and the legibility of every text run. Each of them reads hundreds
// or thousands of points of one frame, and the harness's `h.pixel` is one
// `getImageData` per point — so this pulls the whole backing store back once
// and serves every reading of that frame out of it.
//
// IT IS A SNAPSHOT, NOT A VIEW. The buffer is copied at the moment `rasterOf`
// is called, so a later frame cannot change what an earlier reading measured,
// and two frames can be held side by side — which is what `hud-bays` compares.
//
// The mapping from a stage coordinate to a device pixel is the harness's own
// `h.device`, so a raster reads the same under whatever fit and pixel density a
// check built its harness at.
//
// Local to this group because reading pixels in bulk is the presentation
// group's own business; every other group in this suite reads state, positions
// and draw calls instead.

import { assertTrue } from "../assert";
import { colorDistance, type Harness, type Rgb } from "../harness";

/** One frame's backing store, addressed in logical stage units. */
export interface Raster {
  /** The colour at a logical point, clamped to the canvas's own bounds. */
  at(x: number, y: number): Rgb;
}

/** Pull the whole canvas back and hand out a reader over it. */
export function rasterOf(h: Harness): Raster {
  const width = h.canvas.width;
  const height = h.canvas.height;
  assertTrue(
    width > 0 && height > 0,
    "the runtime drew into a canvas with area, so a frame's pixels can be read",
  );
  const { data } = h.ctx.getImageData(0, 0, width, height);
  return {
    at(x: number, y: number): Rgb {
      const point = h.device(x, y);
      const dx = Math.min(Math.max(point.x, 0), width - 1);
      const dy = Math.min(Math.max(point.y, 0), height - 1);
      const i = (dy * width + dx) * 4;
      return { r: data[i], g: data[i + 1], b: data[i + 2] };
    },
  };
}

/** The RGB distance between the same logical point of two frames. */
export function changeBetween(
  before: Raster,
  after: Raster,
  x: number,
  y: number,
): number {
  return colorDistance(before.at(x, y), after.at(x, y));
}
