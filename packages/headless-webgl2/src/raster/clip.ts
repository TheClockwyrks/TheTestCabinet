/**
 * Near-plane clipping and the viewport transform — the geometry step between
 * the vertex shader's clip-space output and the rasterizers' window space.
 *
 * Only the near plane is clipped geometrically (Sutherland–Hodgman against
 * `w > ε`), because it is the one plane a raster bound cannot stand in for:
 * a vertex at or behind the camera flips under the perspective divide and
 * would rasterize wraparound garbage. Far-plane and x/y clipping are handled
 * by the depth-range clamp and by bounding the raster to the viewport ∩
 * scissor rectangle — honest for the numbers involved, per the package spec.
 *
 * Varyings are interpolated linearly in clip space at the clip boundary,
 * which is exact: clip-space interpolation is what perspective-correct raster
 * interpolation reconstructs, so a clipped edge carries the same values the
 * unclipped edge would have carried at that point.
 */

/**
 * The clip boundary: a vertex is in front of the camera when `w` exceeds
 * this. Small enough that no plausible camera geometry is trimmed, large
 * enough that the later `1 / w` stays finite.
 */
export const NEAR_EPS = 1e-6;

/** One vertex-shader result: clip-space gl_Position plus the varying register file. */
export interface ClipVertex {
  /** Clip-space position (x, y, z, w). */
  readonly position: Float64Array;
  /** The vertex stage's varying outputs, not yet divided by w. */
  readonly varyings: Float64Array;
}

/** One vertex in window space, carrying what the rasterizers interpolate. */
export interface WindowVertex {
  /** Window x, pixel units, +x right. */
  readonly x: number;
  /** Window y, pixel units, +y up (row 0 is the bottom, GL's own order). */
  readonly y: number;
  /** Window depth mapped through depthRange; the rasterizer clamps to [0, 1] per fragment. */
  readonly z: number;
  /** 1 / clip w — the perspective-correct interpolation denominator and gl_FragCoord.w. */
  readonly invW: number;
  /** varyings × invW — the perspective-correct interpolation numerators. */
  readonly vow: Float64Array;
}

/** Linear clip-space interpolation between two vertices at parameter `t`. */
function lerpVertex(a: ClipVertex, b: ClipVertex, t: number): ClipVertex {
  const position = new Float64Array(4);
  for (let i = 0; i < 4; i += 1) {
    position[i] = (a.position[i] ?? 0) + t * ((b.position[i] ?? 0) - (a.position[i] ?? 0));
  }
  const count = a.varyings.length;
  const varyings = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    varyings[i] = (a.varyings[i] ?? 0) + t * ((b.varyings[i] ?? 0) - (a.varyings[i] ?? 0));
  }
  return { position, varyings };
}

/**
 * Clips a convex polygon (a triangle, here) against the near plane `w > ε`,
 * Sutherland–Hodgman: vertices in front are kept, each in/out crossing adds
 * the boundary intersection. A triangle yields 0, 3, or 4 vertices; the
 * caller fans a 4-vertex result into two triangles.
 */
export function clipPolygonToNearPlane(vertices: readonly ClipVertex[]): ClipVertex[] {
  let anyIn = false;
  let anyOut = false;
  for (const vertex of vertices) {
    if ((vertex.position[3] ?? 0) > NEAR_EPS) anyIn = true;
    else anyOut = true;
  }
  if (!anyIn) return [];
  if (!anyOut) return [...vertices];
  const out: ClipVertex[] = [];
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (a === undefined || b === undefined) continue;
    const da = (a.position[3] ?? 0) - NEAR_EPS;
    const db = (b.position[3] ?? 0) - NEAR_EPS;
    const aIn = da > 0;
    if (aIn) out.push(a);
    if (aIn !== db > 0) out.push(lerpVertex(a, b, da / (da - db)));
  }
  return out;
}

/**
 * Clips a line segment against the near plane: both behind drops the line,
 * one behind moves that endpoint to the boundary.
 */
export function clipSegmentToNearPlane(a: ClipVertex, b: ClipVertex): readonly [ClipVertex, ClipVertex] | null {
  const da = (a.position[3] ?? 0) - NEAR_EPS;
  const db = (b.position[3] ?? 0) - NEAR_EPS;
  if (da <= 0 && db <= 0) return null;
  if (da > 0 && db > 0) return [a, b];
  const crossing = lerpVertex(a, b, da / (da - db));
  return da > 0 ? [a, crossing] : [crossing, b];
}

/**
 * The perspective divide and viewport transform: clip space → NDC → window
 * pixels, with depth mapped through `depthRange`, and the varyings
 * pre-multiplied by 1/w so the rasterizers interpolate numerators directly.
 * Pixel centers sit at +0.5, per the GL window-coordinate convention.
 */
export function toWindow(vertex: ClipVertex, viewport: readonly [number, number, number, number], depthRange: readonly [number, number]): WindowVertex {
  const w = vertex.position[3] ?? 1;
  const invW = 1 / w;
  const ndcX = (vertex.position[0] ?? 0) * invW;
  const ndcY = (vertex.position[1] ?? 0) * invW;
  const ndcZ = (vertex.position[2] ?? 0) * invW;
  const x = viewport[0] + (ndcX + 1) * 0.5 * viewport[2];
  const y = viewport[1] + (ndcY + 1) * 0.5 * viewport[3];
  const z = depthRange[0] + (ndcZ + 1) * 0.5 * (depthRange[1] - depthRange[0]);
  const count = vertex.varyings.length;
  const vow = new Float64Array(count);
  for (let i = 0; i < count; i += 1) vow[i] = (vertex.varyings[i] ?? 0) * invW;
  return { x, y, z, invW, vow };
}
