/**
 * The GLSL front end's public face: compile one stage, link two stages into
 * an executable program. This module owns the layout decisions — attribute
 * locations, varying offsets, uniform slots — because they are inherently
 * cross-stage: a varying's offset must agree between the vertex writer and
 * the fragment reader, and a uniform declared in both stages is one storage.
 *
 * Results come back as values, never throws: a failed compile or link is an
 * ordinary outcome the context turns into COMPILE_STATUS/LINK_STATUS false
 * with an info log, exactly as a browser reports it.
 */

import { CompileError, componentCount, glTypeEnum, sameType, typeName } from "./ast";
import type { Type } from "./ast";
import { checkShader, type CheckedShader, type Stage } from "./check";
import { emitStage, type StageLayout } from "./emit";

export type { CheckedShader, Stage };

/* ------------------------------------------------------------------------ */
/* The executable program representation (stage 3's calling contract)       */
/* ------------------------------------------------------------------------ */

/**
 * A texture sampler the rasterizer supplies per draw, indexed by texture
 * unit. It returns a 4-component RGBA view in [0,1] floats; the view is owned
 * and reused by the sampler, which is safe because generated code copies the
 * components into scalars before the next lookup.
 */
export type SamplerFn = (u: number, v: number, lod: number) => ArrayLike<number>;

/**
 * The vertex stage function. `attributes` is a flat register file of
 * 4 components per attribute location (`location * 4 + component`);
 * `varyingsOut` receives `varyingComponents` floats; `positionOut` receives
 * clip-space gl_Position (x, y, z, w).
 */
export type VertexFn = (attributes: Float64Array, uniforms: Float64Array, samplers: readonly SamplerFn[], varyingsOut: Float64Array, positionOut: Float64Array) => void;

/**
 * The fragment stage function. `varyings` carries the interpolated register
 * file (same layout the vertex stage wrote), `fragCoord` is gl_FragCoord
 * (x, y, z, 1/w), and `colorOut` receives the RGBA output. Returns true when
 * the fragment discarded — in which case `colorOut` must be ignored.
 */
export type FragmentFn = (varyings: Float64Array, uniforms: Float64Array, samplers: readonly SamplerFn[], fragCoord: Float64Array, frontFacing: boolean, colorOut: Float64Array) => boolean;

/** One active attribute, as `getActiveAttrib`/`getAttribLocation` report it. */
export interface LinkedAttribute {
  readonly name: string;
  readonly location: number;
  readonly type: Type;
  readonly glType: number;
  /** Components the vertex shader actually reads (1–4); fetch fills the rest with (0,0,0,1). */
  readonly componentCount: number;
}

/** One active uniform: a scalar/vector/matrix/sampler, or a whole array (size > 1). */
export interface LinkedUniform {
  /** The introspected name: arrays report as `name[0]`, per GL. */
  readonly name: string;
  /** The declared name without any suffix, the key for location lookups. */
  readonly baseName: string;
  /** The element type (for an array, the type of one element). */
  readonly type: Type;
  /** Array length, or 1 for a non-array. */
  readonly size: number;
  /** Base slot in the flat f64 uniform store. */
  readonly slot: number;
  readonly glType: number;
  readonly isSampler: boolean;
}

/** A linked, executable program: the layout plus the two compiled stage functions. */
export interface LinkedProgram {
  readonly attributes: readonly LinkedAttribute[];
  readonly uniforms: readonly LinkedUniform[];
  /** Total f64 slots a uniform store for this program needs. */
  readonly uniformSlotCount: number;
  /** Total interpolated components a varying register file needs. */
  readonly varyingComponents: number;
  readonly vertex: VertexFn;
  readonly fragment: FragmentFn;
}

/* ------------------------------------------------------------------------ */
/* Compilation                                                              */
/* ------------------------------------------------------------------------ */

export type CompileResult = { readonly ok: true; readonly shader: CheckedShader } | { readonly ok: false; readonly log: string };

/**
 * Compiles one stage: parse and check. Emission waits for link time, because
 * storage layout (varying offsets, uniform slots) is a cross-stage decision.
 */
export function compileStage(source: string, stage: Stage): CompileResult {
  try {
    return { ok: true, shader: checkShader(source, stage) };
  } catch (error) {
    if (error instanceof CompileError) return { ok: false, log: error.toLog() };
    throw error;
  }
}

/* ------------------------------------------------------------------------ */
/* Linking                                                                  */
/* ------------------------------------------------------------------------ */

export type LinkResult = { readonly ok: true; readonly program: LinkedProgram } | { readonly ok: false; readonly log: string };

/** A link failure: like CompileError but with no source line to point at. */
class LinkError extends Error {}

/**
 * Links a checked vertex and fragment shader: assigns attribute locations
 * (layout qualifier first, then `bindAttribLocation` requests, then lowest
 * free), matches varyings by name and type, merges the uniform tables, emits
 * both stages, and compiles the emitted JS with `new Function`.
 */
export function linkStages(vertex: CheckedShader, fragment: CheckedShader, boundAttribLocations: ReadonlyMap<string, number>): LinkResult {
  try {
    const attributes = assignAttributeLocations(vertex, boundAttribLocations);
    const { varyingOffsets, varyingComponents } = matchVaryings(vertex, fragment);
    const { uniforms, uniformSlots, uniformSlotCount } = mergeUniforms(vertex, fragment);

    const layout: StageLayout = {
      attributeLocations: new Map(attributes.map((a) => [a.name, a.location])),
      varyingOffsets,
      uniformSlots,
    };

    const vertexSource = emitStage(vertex, layout);
    const fragmentSource = emitStage(fragment, layout);
    // eslint-disable-next-line no-new-func -- codegen is the execution model (spec §4.4)
    const vertexFn = new Function(vertexSource)() as VertexFn;
    const fragmentFn = new Function(fragmentSource)() as FragmentFn;

    return {
      ok: true,
      program: { attributes, uniforms, uniformSlotCount, varyingComponents, vertex: vertexFn, fragment: fragmentFn },
    };
  } catch (error) {
    if (error instanceof LinkError) return { ok: false, log: `ERROR: ${error.message}` };
    throw error;
  }
}

/** The location budget mirrors the context's MAX_VERTEX_ATTRIBS. */
const MAX_ATTRIB_LOCATIONS = 16;

function assignAttributeLocations(vertex: CheckedShader, bound: ReadonlyMap<string, number>): LinkedAttribute[] {
  const taken = new Map<number, string>();
  const results: { name: string; type: Type; location: number | null }[] = vertex.ins.map((info) => ({ name: info.name, type: info.type, location: null }));

  // Pass 1: layout(location = N) — the shader's own word, strongest.
  for (let i = 0; i < vertex.ins.length; i += 1) {
    const info = vertex.ins[i];
    const result = results[i];
    if (info === undefined || result === undefined || info.layoutLocation === null) continue;
    const holder = taken.get(info.layoutLocation);
    if (holder !== undefined) {
      throw new LinkError(`the attributes '${holder}' and '${info.name}' both claim location ${info.layoutLocation}`);
    }
    taken.set(info.layoutLocation, info.name);
    result.location = info.layoutLocation;
  }

  // Pass 2: bindAttribLocation requests, honored where the shader said nothing.
  for (const result of results) {
    if (result.location !== null) continue;
    const requested = bound.get(result.name);
    if (requested === undefined) continue;
    if (requested < 0 || requested >= MAX_ATTRIB_LOCATIONS) {
      throw new LinkError(`bindAttribLocation put '${result.name}' at ${requested}, outside 0..${MAX_ATTRIB_LOCATIONS - 1}`);
    }
    const holder = taken.get(requested);
    if (holder !== undefined) {
      throw new LinkError(`bindAttribLocation put '${result.name}' at ${requested}, already claimed by '${holder}'`);
    }
    taken.set(requested, result.name);
    result.location = requested;
  }

  // Pass 3: lowest free location for the rest, in declaration order.
  for (const result of results) {
    if (result.location !== null) continue;
    let free = 0;
    while (taken.has(free)) free += 1;
    if (free >= MAX_ATTRIB_LOCATIONS) {
      throw new LinkError(`the vertex shader needs more than ${MAX_ATTRIB_LOCATIONS} attribute locations`);
    }
    taken.set(free, result.name);
    result.location = free;
  }

  return results.map((result) => ({
    name: result.name,
    location: result.location ?? 0,
    type: result.type,
    glType: glTypeEnum(result.type),
    componentCount: componentCount(result.type),
  }));
}

/** Varyings vec-align to 15 vec4s worth of components, the MAX_VARYING_VECTORS the context reports. */
const MAX_VARYING_COMPONENTS = 60;

function matchVaryings(vertex: CheckedShader, fragment: CheckedShader): { varyingOffsets: Map<string, number>; varyingComponents: number } {
  const varyingOffsets = new Map<string, number>();
  let offset = 0;

  const vertexOuts = new Map(vertex.outs.map((info) => [info.name, info]));

  // The fragment inputs define the read layout; every one must be fed.
  for (const input of fragment.ins) {
    const writer = vertexOuts.get(input.name);
    if (writer === undefined) {
      throw new LinkError(`the fragment input '${input.name}' has no matching vertex output; declare 'out ${typeName(input.type)} ${input.name}' in the vertex shader`);
    }
    if (!sameType(writer.type, input.type)) {
      throw new LinkError(`the varying '${input.name}' is ${typeName(writer.type)} in the vertex shader but ${typeName(input.type)} in the fragment shader`);
    }
    varyingOffsets.set(input.name, offset);
    offset += componentCount(input.type);
  }

  // Unread vertex outputs still need storage to write into; appended after.
  for (const output of vertex.outs) {
    if (varyingOffsets.has(output.name)) continue;
    varyingOffsets.set(output.name, offset);
    offset += componentCount(output.type);
  }

  if (offset > MAX_VARYING_COMPONENTS) {
    throw new LinkError(`the program uses ${offset} varying components, over the limit of ${MAX_VARYING_COMPONENTS} (15 vec4s)`);
  }
  return { varyingOffsets, varyingComponents: offset };
}

function mergeUniforms(vertex: CheckedShader, fragment: CheckedShader): { uniforms: LinkedUniform[]; uniformSlots: Map<string, number>; uniformSlotCount: number } {
  const uniforms: LinkedUniform[] = [];
  const uniformSlots = new Map<string, number>();
  const seen = new Map<string, Type>();
  let slot = 0;

  for (const info of [...vertex.uniforms, ...fragment.uniforms]) {
    const existing = seen.get(info.name);
    if (existing !== undefined) {
      // Declared in both stages: one storage, and the types must agree.
      if (!sameType(existing, info.type)) {
        throw new LinkError(`the uniform '${info.name}' is ${typeName(existing)} in one stage and ${typeName(info.type)} in the other`);
      }
      continue;
    }
    seen.set(info.name, info.type);
    uniformSlots.set(info.name, slot);
    const isArray = info.type.kind === "array";
    const elementType: Type = info.type.kind === "array" ? info.type.element : info.type;
    uniforms.push({
      name: isArray ? `${info.name}[0]` : info.name,
      baseName: info.name,
      type: elementType,
      size: info.type.kind === "array" ? info.type.length : 1,
      slot,
      glType: glTypeEnum(elementType),
      isSampler: elementType.kind === "sampler2D",
    });
    slot += componentCount(info.type);
  }

  return { uniforms, uniformSlots, uniformSlotCount: slot };
}
