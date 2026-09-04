/**
 * The draw pipeline: `drawArrays`/`drawElements` orchestration from GL-level
 * validation through vertex fetch, vertex shading, primitive assembly,
 * near-plane clipping, the viewport transform, and dispatch to the triangle,
 * line, and point rasterizers.
 *
 * Validation runs to completion **before** any pixel or any vertex shader
 * invocation, because a refused draw must latch its error and leave the
 * framebuffer untouched — GL's contract, and what makes a validator's
 * readback trustworthy after a checked `getError`.
 *
 * Vertex results are cached per vertex index for the duration of one draw
 * (the index-dedup cache the spec calls for), so an indexed mesh runs its
 * vertex shader once per unique vertex, not once per primitive corner.
 */

import { GL } from "../constants";
import type { SamplerFn } from "../glsl/link";
import { LIMITS, type ContextState } from "../state";
import type { BufferObject } from "../objects";
import type { DefaultFramebuffer } from "./framebuffer";
import {
  clipPolygonToNearPlane,
  clipSegmentToNearPlane,
  NEAR_EPS,
  toWindow,
  type ClipVertex,
} from "./clip";
import { rasterizeTriangle, type DrawEnv } from "./triangle";
import { rasterizeLine, rasterizePoint } from "./line";
import { samplerFor } from "./texture";

/** What the context hands the pipeline: its state, its target, and its error latch. */
export interface DrawIo {
  readonly state: ContextState;
  readonly framebuffer: DefaultFramebuffer;
  readonly recordError: (code: number) => void;
}

/** Every primitive mode the subset draws (all seven of ES 3.0's). */
const DRAW_MODES: readonly number[] = [
  GL.POINTS,
  GL.LINES,
  GL.LINE_LOOP,
  GL.LINE_STRIP,
  GL.TRIANGLES,
  GL.TRIANGLE_STRIP,
  GL.TRIANGLE_FAN,
];

/** drawElements index types → byte size. */
const INDEX_TYPE_SIZES = new Map<number, number>([
  [GL.UNSIGNED_BYTE, 1],
  [GL.UNSIGNED_SHORT, 2],
  [GL.UNSIGNED_INT, 4],
]);

/** Byte sizes of the vertex fetch types the subset stores. */
const ATTRIB_TYPE_SIZES = new Map<number, number>([
  [GL.FLOAT, 4],
  [GL.BYTE, 1],
  [GL.UNSIGNED_BYTE, 1],
  [GL.SHORT, 2],
  [GL.UNSIGNED_SHORT, 2],
]);

/** Fills one vertex's four component slots of the attribute register file. */
type AttribFetcher = (vertexIndex: number, registers: Float64Array) => void;

/**
 * `drawArrays`: validates, then draws vertices `first .. first + count - 1`.
 * The context has already coerced the integer arguments.
 */
export function drawArraysImpl(
  io: DrawIo,
  mode: number,
  first: number,
  count: number,
): void {
  if (!DRAW_MODES.includes(mode)) {
    io.recordError(GL.INVALID_ENUM);
    return;
  }
  if (first < 0 || count < 0) {
    io.recordError(GL.INVALID_VALUE);
    return;
  }
  if (!hasRunnableProgram(io)) return;
  if (count === 0) return;
  executeDraw(io, mode, count, null, first, first + count - 1);
}

/**
 * `drawElements`: validates the index stream (type, alignment, range), reads
 * the indices out of the VAO's element array buffer, and draws. The WebGL2
 * always-on primitive restart is honored: an index equal to the type's
 * maximum splits primitive assembly rather than addressing a vertex.
 */
export function drawElementsImpl(
  io: DrawIo,
  mode: number,
  count: number,
  type: number,
  offset: number,
): void {
  if (!DRAW_MODES.includes(mode)) {
    io.recordError(GL.INVALID_ENUM);
    return;
  }
  const typeSize = INDEX_TYPE_SIZES.get(type);
  if (typeSize === undefined) {
    io.recordError(GL.INVALID_ENUM);
    return;
  }
  if (count < 0 || offset < 0) {
    io.recordError(GL.INVALID_VALUE);
    return;
  }
  if (offset % typeSize !== 0) {
    io.recordError(GL.INVALID_OPERATION);
    return;
  }
  const elementBuffer = io.state.vertexArray.elementArrayBuffer;
  if (elementBuffer === null) {
    io.recordError(GL.INVALID_OPERATION);
    return;
  }
  if (!hasRunnableProgram(io)) return;
  if (count === 0) return;

  const data = elementBuffer.data;
  if (data === null || offset + count * typeSize > data.length) {
    io.recordError(GL.INVALID_OPERATION);
    return;
  }
  // The copies below are aligned by construction: buffer stores start at
  // byte offset 0 of their own ArrayBuffer and `offset % typeSize === 0`.
  const indices = new Uint32Array(count);
  if (typeSize === 1) {
    for (let i = 0; i < count; i += 1) indices[i] = data[offset + i] ?? 0;
  } else if (typeSize === 2) {
    const view = new Uint16Array(data.buffer, data.byteOffset + offset, count);
    indices.set(view);
  } else {
    const view = new Uint32Array(data.buffer, data.byteOffset + offset, count);
    indices.set(view);
  }
  const restart = typeSize === 1 ? 0xff : typeSize === 2 ? 0xffff : 0xffffffff;

  let maxVertex = -1;
  for (let i = 0; i < count; i += 1) {
    const value = indices[i] ?? 0;
    if (value !== restart && value > maxVertex) maxVertex = value;
  }
  // Every index was a restart: a valid draw that assembles nothing.
  if (maxVertex === -1) return;
  executeDraw(io, mode, count, { indices, restart }, 0, maxVertex);
}

/** Latching validation that a draw has a linked, executable program in use. */
function hasRunnableProgram(io: DrawIo): boolean {
  const program = io.state.program;
  if (
    program === null ||
    !program.linkStatus ||
    program.executable === null ||
    program.uniformStore === null
  ) {
    io.recordError(GL.INVALID_OPERATION);
    return false;
  }
  return true;
}

/**
 * The shared draw body. `elements` is null for drawArrays (vertex i is
 * `first + i`); `maxVertex` is the highest vertex index any attribute fetch
 * will touch, for the up-front buffer range validation.
 */
function executeDraw(
  io: DrawIo,
  mode: number,
  count: number,
  elements: { indices: Uint32Array; restart: number } | null,
  first: number,
  maxVertex: number,
): void {
  const state = io.state;
  const framebuffer = io.framebuffer;
  const program = state.program;
  const executable = program?.executable;
  const uniformStore = program?.uniformStore;
  if (program == null || executable == null || uniformStore == null) return;

  /* -- attribute fetchers, with the whole-range check up front ---------- */
  const fetchers: AttribFetcher[] = [];
  for (const attribute of executable.attributes) {
    const slot = state.vertexArray.attribs[attribute.location];
    if (slot === undefined) {
      io.recordError(GL.INVALID_OPERATION);
      return;
    }
    if (!slot.enabled) {
      const generic = state.genericAttribs[attribute.location];
      if (generic === undefined) {
        io.recordError(GL.INVALID_OPERATION);
        return;
      }
      const base = attribute.location * 4;
      fetchers.push((_vertex, registers) => {
        registers[base] = generic[0] ?? 0;
        registers[base + 1] = generic[1] ?? 0;
        registers[base + 2] = generic[2] ?? 0;
        registers[base + 3] = generic[3] ?? 1;
      });
      continue;
    }
    const buffer = slot.buffer;
    if (buffer === null || buffer.deleted || buffer.data === null) {
      // An enabled array with nothing behind it cannot be fetched, per WebGL.
      io.recordError(GL.INVALID_OPERATION);
      return;
    }
    const typeSize = ATTRIB_TYPE_SIZES.get(slot.type) ?? 4;
    const stride = slot.stride === 0 ? slot.size * typeSize : slot.stride;
    const needed = slot.offset + maxVertex * stride + slot.size * typeSize;
    if (needed > buffer.data.length) {
      // WebGL validates the whole fetch range before drawing anything.
      io.recordError(GL.INVALID_OPERATION);
      return;
    }
    fetchers.push(
      makeArrayFetcher(
        buffer,
        slot.type,
        slot.size,
        slot.normalized,
        stride,
        slot.offset,
        attribute.location,
      ),
    );
  }

  /* -- sampler units, validated before any shader runs ------------------ */
  for (const uniform of executable.uniforms) {
    if (!uniform.isSampler) continue;
    const unit = Math.trunc(uniformStore[uniform.slot] ?? 0);
    if (unit < 0 || unit >= LIMITS.textureUnits) {
      io.recordError(GL.INVALID_OPERATION);
      return;
    }
  }
  const samplers: SamplerFn[] = state.textureUnits.map((unit) =>
    samplerFor(unit.texture2d),
  );

  /* -- raster bounds: viewport ∩ scissor ∩ framebuffer, in samples ------ */
  // The rasterizers run in sample space: with the antialias attribute the
  // planes hold `scale`² samples per pixel, so the user-space viewport and
  // scissor rectangles scale up here (state queries keep reporting the
  // user-space values — the scaling is invisible except through
  // gl_FragCoord, which honestly carries sample coordinates).
  const scale = framebuffer.scale;
  const [vx, vy, vw, vh] = state.viewport;
  let bx0 = Math.max(0, vx * scale);
  let by0 = Math.max(0, vy * scale);
  let bx1 = Math.min(framebuffer.sampleWidth, (vx + vw) * scale);
  let by1 = Math.min(framebuffer.sampleHeight, (vy + vh) * scale);
  if (state.capabilities.get(GL.SCISSOR_TEST) === true) {
    const [sx, sy, sw, sh] = state.scissor;
    bx0 = Math.max(bx0, sx * scale);
    by0 = Math.max(by0, sy * scale);
    bx1 = Math.min(bx1, (sx + sw) * scale);
    by1 = Math.min(by1, (sy + sh) * scale);
  }
  // An empty target is a valid draw with nothing visible; validation above
  // has already latched anything worth latching.
  if (bx1 <= bx0 || by1 <= by0) return;

  const env: DrawEnv = {
    color: framebuffer.colorPlane,
    depth: framebuffer.depthPlane,
    fbWidth: framebuffer.sampleWidth,
    scale,
    opaque: framebuffer.opaque,
    bx0,
    by0,
    bx1,
    by1,
    depthTest: state.capabilities.get(GL.DEPTH_TEST) === true,
    depthWrite: state.depthMask,
    depthFunc: state.depthFunc,
    blend: state.capabilities.get(GL.BLEND) === true,
    blendSrcRgb: state.blendSrcRgb,
    blendDstRgb: state.blendDstRgb,
    blendSrcAlpha: state.blendSrcAlpha,
    blendDstAlpha: state.blendDstAlpha,
    blendEquationRgb: state.blendEquationRgb,
    blendEquationAlpha: state.blendEquationAlpha,
    blendConstant: state.blendColor,
    colorMask: state.colorMask,
    cullEnabled: state.capabilities.get(GL.CULL_FACE) === true,
    cullMode: state.cullFaceMode,
    frontFaceCcw: state.frontFace === GL.CCW,
    polygonOffsetOn: state.capabilities.get(GL.POLYGON_OFFSET_FILL) === true,
    polygonOffsetFactor: state.polygonOffsetFactor,
    polygonOffsetUnits: state.polygonOffsetUnits,
    fragment: executable.fragment,
    uniforms: uniformStore,
    samplers,
    varyingCount: executable.varyingComponents,
    varyings: new Float64Array(executable.varyingComponents),
    fragCoord: new Float64Array(4),
    colorOut: new Float64Array(4),
  };

  /* -- vertex shading, cached per vertex index -------------------------- */
  const registers = new Float64Array(LIMITS.maxVertexAttribs * 4);
  const cache = new Map<number, ClipVertex>();
  const vertexAt = (position: number): ClipVertex => {
    const index =
      elements === null ? first + position : (elements.indices[position] ?? 0);
    const hit = cache.get(index);
    if (hit !== undefined) return hit;
    for (const fetch of fetchers) fetch(index, registers);
    const varyings = new Float64Array(executable.varyingComponents);
    const clipPosition = new Float64Array(4);
    executable.vertex(
      registers,
      uniformStore,
      samplers,
      varyings,
      clipPosition,
    );
    const vertex: ClipVertex = { position: clipPosition, varyings };
    cache.set(index, vertex);
    return vertex;
  };

  // The viewport transform lands vertices in sample space directly, so the
  // one transform serves both the antialiased and single-sample paths.
  const viewport: readonly [number, number, number, number] = [
    vx * scale,
    vy * scale,
    vw * scale,
    vh * scale,
  ];
  const depthRange = state.depthRange;

  const emitTriangle = (i0: number, i1: number, i2: number): void => {
    const polygon = clipPolygonToNearPlane([
      vertexAt(i0),
      vertexAt(i1),
      vertexAt(i2),
    ]);
    if (polygon.length < 3) return;
    const window = polygon.map((vertex) =>
      toWindow(vertex, viewport, depthRange),
    );
    for (let k = 1; k + 1 < window.length; k += 1) {
      const a = window[0];
      const b = window[k];
      const c = window[k + 1];
      if (a !== undefined && b !== undefined && c !== undefined)
        rasterizeTriangle(env, a, b, c);
    }
  };

  const emitLine = (i0: number, i1: number): void => {
    const clipped = clipSegmentToNearPlane(vertexAt(i0), vertexAt(i1));
    if (clipped === null) return;
    rasterizeLine(
      env,
      toWindow(clipped[0], viewport, depthRange),
      toWindow(clipped[1], viewport, depthRange),
    );
  };

  const emitPoint = (i0: number): void => {
    const vertex = vertexAt(i0);
    if ((vertex.position[3] ?? 0) <= NEAR_EPS) return;
    rasterizePoint(env, toWindow(vertex, viewport, depthRange));
  };

  /* -- assembly, per restart-split segment ------------------------------ */
  for (const [start, length] of segments(count, elements)) {
    switch (mode) {
      case GL.POINTS:
        for (let i = 0; i < length; i += 1) emitPoint(start + i);
        break;
      case GL.LINES:
        for (let i = 0; i + 1 < length; i += 2)
          emitLine(start + i, start + i + 1);
        break;
      case GL.LINE_STRIP:
        for (let i = 0; i + 1 < length; i += 1)
          emitLine(start + i, start + i + 1);
        break;
      case GL.LINE_LOOP:
        for (let i = 0; i + 1 < length; i += 1)
          emitLine(start + i, start + i + 1);
        if (length >= 2) emitLine(start + length - 1, start);
        break;
      case GL.TRIANGLES:
        for (let i = 0; i + 2 < length; i += 3)
          emitTriangle(start + i, start + i + 1, start + i + 2);
        break;
      case GL.TRIANGLE_STRIP:
        // Odd triangles swap two corners so every strip triangle keeps the
        // strip's winding, per the GL assembly rule.
        for (let i = 0; i + 2 < length; i += 1) {
          if (i % 2 === 0)
            emitTriangle(start + i, start + i + 1, start + i + 2);
          else emitTriangle(start + i + 1, start + i, start + i + 2);
        }
        break;
      default:
        // TRIANGLE_FAN — the only remaining mode.
        for (let i = 1; i + 1 < length; i += 1)
          emitTriangle(start, start + i, start + i + 1);
    }
  }
}

/**
 * Splits the drawn positions `0 .. count-1` into assembly runs at primitive
 * restart indices. drawArrays has no restart and is one run.
 */
function segments(
  count: number,
  elements: { indices: Uint32Array; restart: number } | null,
): Array<readonly [number, number]> {
  if (elements === null) return [[0, count]];
  const out: Array<readonly [number, number]> = [];
  let start = 0;
  for (let i = 0; i < count; i += 1) {
    if (elements.indices[i] === elements.restart) {
      if (i > start) out.push([start, i - start]);
      start = i + 1;
    }
  }
  if (count > start) out.push([start, count - start]);
  return out;
}

/**
 * Builds the fetch closure for one enabled attribute array: a typed view
 * over the buffer store (aligned by construction — stride and offset are
 * type-size multiples and stores start at byte offset 0), component
 * conversion per the fetch type with the ES 3.0 normalization rules, and
 * the (0, 0, 0, 1) defaults for components the pointer does not supply.
 */
function makeArrayFetcher(
  buffer: BufferObject,
  type: number,
  size: number,
  normalized: boolean,
  stride: number,
  offset: number,
  location: number,
): AttribFetcher {
  const data = buffer.data;
  if (data === null)
    throw new Error(
      "headless-webgl2: internal invariant broken: a validated attribute buffer lost its store",
    );
  const base = location * 4;

  /** Writes the fetched components plus defaults into the register file. */
  const write = (
    registers: Float64Array,
    c0: number,
    c1: number,
    c2: number,
    c3: number,
  ): void => {
    registers[base] = c0;
    registers[base + 1] = size > 1 ? c1 : 0;
    registers[base + 2] = size > 2 ? c2 : 0;
    registers[base + 3] = size > 3 ? c3 : 1;
  };

  if (type === GL.FLOAT) {
    const view = new Float32Array(
      data.buffer,
      data.byteOffset,
      Math.floor(data.byteLength / 4),
    );
    return (vertex, registers) => {
      const at = (offset + vertex * stride) >> 2;
      write(
        registers,
        view[at] ?? 0,
        view[at + 1] ?? 0,
        view[at + 2] ?? 0,
        view[at + 3] ?? 0,
      );
    };
  }
  if (type === GL.UNSIGNED_BYTE) {
    const toValue = normalized
      ? (v: number): number => v / 255
      : (v: number): number => v;
    return (vertex, registers) => {
      const at = offset + vertex * stride;
      write(
        registers,
        toValue(data[at] ?? 0),
        toValue(data[at + 1] ?? 0),
        toValue(data[at + 2] ?? 0),
        toValue(data[at + 3] ?? 0),
      );
    };
  }
  if (type === GL.BYTE) {
    const view = new Int8Array(data.buffer, data.byteOffset, data.byteLength);
    // Signed normalization per ES 3.0: c / (2^(b-1) - 1), clamped at -1.
    const toValue = normalized
      ? (v: number): number => Math.max(v / 127, -1)
      : (v: number): number => v;
    return (vertex, registers) => {
      const at = offset + vertex * stride;
      write(
        registers,
        toValue(view[at] ?? 0),
        toValue(view[at + 1] ?? 0),
        toValue(view[at + 2] ?? 0),
        toValue(view[at + 3] ?? 0),
      );
    };
  }
  if (type === GL.UNSIGNED_SHORT) {
    const view = new Uint16Array(
      data.buffer,
      data.byteOffset,
      Math.floor(data.byteLength / 2),
    );
    const toValue = normalized
      ? (v: number): number => v / 65535
      : (v: number): number => v;
    return (vertex, registers) => {
      const at = (offset + vertex * stride) >> 1;
      write(
        registers,
        toValue(view[at] ?? 0),
        toValue(view[at + 1] ?? 0),
        toValue(view[at + 2] ?? 0),
        toValue(view[at + 3] ?? 0),
      );
    };
  }
  // SHORT — the only remaining stored fetch type.
  const view = new Int16Array(
    data.buffer,
    data.byteOffset,
    Math.floor(data.byteLength / 2),
  );
  const toValue = normalized
    ? (v: number): number => Math.max(v / 32767, -1)
    : (v: number): number => v;
  return (vertex, registers) => {
    const at = (offset + vertex * stride) >> 1;
    write(
      registers,
      toValue(view[at] ?? 0),
      toValue(view[at + 1] ?? 0),
      toValue(view[at + 2] ?? 0),
      toValue(view[at + 3] ?? 0),
    );
  };
}
