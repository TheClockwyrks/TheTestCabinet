// Shared reads for the Kindle dive's own checks (the outer vision circle).
//
// Every Kindle point turns on one question: is this pixel the pitch-black fog, or is
// the build drawing terrain here? `isDark` (luminance < 26) cannot answer it. The two
// colors the question separates are only a few levels apart — the flat fog `#03060c`
// reads about 7, and REMEMBERED dim corridor reads about 15 — so both sit under that
// threshold and a build with no vision circle at all passes an `isDark` assertion on
// ground it is visibly drawing.
//
// So the Kindle checks compare against the build's OWN fog instead of an absolute cut:
// sample a never-revealed tile, which the spec fixes as flat fog (`specs/gameplay.md`),
// and require the tile under test to match it. That is self-relative — it holds for any
// build's exact fog color — and it is the property the dive actually claims: ground
// beyond the circle is painted back to the same flat fog as ground never explored.
import {
  colorDistance,
  openTiles,
  sampleColor,
  tileCenter,
  unmetPrecondition,
} from "../_helpers.mjs";

/**
 * How close a sample must sit to the build's fog color to read as "painted back to
 * fog". Generous next to the ~16 that separates fog from remembered dim, so antialiasing
 * and a soft circle edge cannot trip it, while still failing terrain that is drawn.
 */
export const FOG_MATCH = 8;

/** True when `col` is the same flat fog the build paints never-revealed ground with. */
export function isFogBlack(col, fog) {
  return colorDistance(col, fog) <= FOG_MATCH;
}

/**
 * The build's own fog color, sampled from a never-revealed open tile at least
 * `minAway` px from every point in `away` (the forager and anything lit — a flare, an
 * effect — so the reference is flat fog and nothing else).
 *
 * Throws an unmet precondition when the board holds no such tile: with the whole maze
 * explored there is no fog left to measure against, which decides nothing about the
 * vision circle.
 */
export async function sampleFog(api, snap, away = [], minAway = 220) {
  for (const [c, r] of openTiles(snap)) {
    if (snap.visibility[r][c] !== "u") continue;
    const p = tileCenter(snap.grid, c, r);
    if (away.some((a) => Math.hypot(p.x - a.x, p.y - a.y) < minAway)) continue;
    return sampleColor(api, p.x, p.y);
  }
  throw unmetPrecondition(
    "no unrevealed tile left to read the build's fog color from",
  );
}
