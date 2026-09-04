/**
 * The context's object records: buffers, vertex arrays, textures, shaders, and
 * programs. Each is a plain class holding exactly the state the spec attaches
 * to that object kind, because keeping object state on the object — rather
 * than in maps keyed by handle — makes the binding model read like the GL
 * specification it implements: binding stores a reference, deleting flags the
 * record, and dangling references behave the way GL says they do.
 *
 * Every record carries a private brand field so a foreign object — something
 * structurally similar handed across the `unknown` casts validator harnesses
 * use — cannot impersonate one, and a `deleted` flag rather than being
 * destroyed, because GL keeps deleted objects alive while references remain.
 */

import { GL } from "./constants";
import type { Type } from "./glsl/ast";
import type { CheckedShader, LinkedProgram } from "./glsl/link";

/* ------------------------------------------------------------------------ */
/* Buffers                                                                  */
/* ------------------------------------------------------------------------ */

/** A buffer object: a byte store plus the usage hint it was given. */
export class BufferObject {
  declare private readonly __brand: "headless-webgl2-buffer";

  /**
   * The buffer's bytes; `null` until the first `bufferData`. Always a copy of
   * what the caller passed, because GL buffer stores are copies — mutating the
   * source array after upload must not change what a later draw reads.
   */
  data: Uint8Array | null = null;

  /** The usage hint from the last `bufferData`; stored only to answer `getBufferParameter`. */
  usage: number = GL.STATIC_DRAW;

  /**
   * Whether the buffer has ever been bound. `isBuffer` answers `false` for a
   * created-but-never-bound name, per the WebGL specification, so creation
   * alone is not enough to make the predicate true.
   */
  everBound = false;

  /** Set by `deleteBuffer`; a deleted buffer refuses re-binding. */
  deleted = false;
}

/* ------------------------------------------------------------------------ */
/* Vertex arrays                                                            */
/* ------------------------------------------------------------------------ */

/**
 * One attribute slot of a vertex array: the fetch description recorded by
 * `vertexAttribPointer` plus its enable flag. The generic (disabled-array)
 * attribute values live on the context, not here, because GL makes them
 * context state — a VAO switch must not change `vertexAttrib4f` results.
 */
export interface VertexAttrib {
  enabled: boolean;
  /** The ARRAY_BUFFER captured at `vertexAttribPointer` time, per GL's binding-capture rule. */
  buffer: BufferObject | null;
  size: number;
  type: number;
  normalized: boolean;
  /** The byte stride as given (0 means tightly packed); `getVertexAttrib` reports this raw value. */
  stride: number;
  offset: number;
}

/** One attribute slot in its just-created state. */
function defaultAttrib(): VertexAttrib {
  return {
    enabled: false,
    buffer: null,
    size: 4,
    type: GL.FLOAT,
    normalized: false,
    stride: 0,
    offset: 0,
  };
}

/**
 * A vertex array object: the per-attribute fetch state and — per the GL
 * specification, and the part naive implementations get wrong — the
 * ELEMENT_ARRAY_BUFFER binding, which lives on the VAO rather than on the
 * context so switching VAOs switches index buffers.
 */
export class VertexArrayObject {
  declare private readonly __brand: "headless-webgl2-vertex-array";

  readonly attribs: VertexAttrib[];

  /** The index-buffer binding this VAO captures. */
  elementArrayBuffer: BufferObject | null = null;

  everBound = false;
  deleted = false;

  /**
   * Whether this is the context's default VAO — the one `bindVertexArray(null)`
   * reaches. It is not deletable and never appears in `VERTEX_ARRAY_BINDING`.
   */
  readonly isDefault: boolean;

  constructor(maxVertexAttribs: number, isDefault = false) {
    this.attribs = Array.from({ length: maxVertexAttribs }, defaultAttrib);
    this.isDefault = isDefault;
  }
}

/* ------------------------------------------------------------------------ */
/* Textures                                                                 */
/* ------------------------------------------------------------------------ */

/** The pixel store `texImage2D` fills for mip level 0 (the only level in 0.1.0). */
export interface TextureImage {
  width: number;
  height: number;
  internalFormat: number;
  format: number;
  type: number;
  /** Bytes per pixel of the stored data (4 for RGBA, 3 for RGB, 1 for the single-channel formats). */
  channels: number;
  /** A tightly packed copy of the uploaded bytes, rows in upload order after any UNPACK_FLIP_Y. */
  data: Uint8Array;
}

/**
 * A 2D texture object: its base-level image and its sampling parameters.
 * Mip levels beyond 0 are absent by design — mipmaps are outside the 0.1.0
 * subset (binding decision 9), and the upload path throws rather than storing
 * a level a sampler could never read.
 */
export class TextureObject {
  declare private readonly __brand: "headless-webgl2-texture";

  /** Level 0, or `null` before the first `texImage2D`. */
  image: TextureImage | null = null;

  /**
   * GL's real default min filter is the mipmapped NEAREST_MIPMAP_LINEAR; it is
   * stored faithfully even though sampling with it is unimplemented, because
   * `getTexParameter` on a fresh texture must answer what a browser answers.
   * The engines set NEAREST or LINEAR on every texture (binding decision 9).
   */
  minFilter: number = GL.NEAREST_MIPMAP_LINEAR;
  magFilter: number = GL.LINEAR;
  wrapS: number = GL.REPEAT;
  wrapT: number = GL.REPEAT;

  /**
   * Set by `texStorage2D`: immutable storage refuses later `texImage2D`
   * reallocation (INVALID_OPERATION, per ES 3.0) while `texSubImage2D`
   * updates remain legal.
   */
  immutable = false;

  everBound = false;
  deleted = false;
}

/* ------------------------------------------------------------------------ */
/* Shaders and programs                                                     */
/* ------------------------------------------------------------------------ */

/**
 * A shader object. `compileShader` runs the GLSL ES 3.00 subset front end
 * over a snapshot of the source; a success stores the checked shader for the
 * linker, a failure stores a position-carrying info log.
 */
export class ShaderObject {
  declare private readonly __brand: "headless-webgl2-shader";

  /** VERTEX_SHADER or FRAGMENT_SHADER. */
  readonly type: number;

  source = "";

  /**
   * The source as it stood at the last `compileShader` call, because GL
   * compiles a snapshot: `shaderSource` after `compileShader` must not change
   * what the program links against.
   */
  compiledSource: string | null = null;

  /** The front end's output for the last successful compile; what `linkProgram` links. */
  compiled: CheckedShader | null = null;

  compileStatus = false;
  infoLog = "";
  deleted = false;

  constructor(type: number) {
    this.type = type;
  }
}

/**
 * A program object: its attachments, its link outcome, the linker-filled
 * location tables, and — after a successful link — the executable program
 * (the emitted vertex/fragment functions) plus its uniform store.
 */
export class ProgramObject {
  declare private readonly __brand: "headless-webgl2-program";

  /** The attached shaders, at most one per type. */
  readonly attached: ShaderObject[] = [];

  linkStatus = false;
  validateStatus = false;
  infoLog = "";
  deleted = false;

  /** `bindAttribLocation` requests, consulted at the next link. */
  readonly boundAttribLocations = new Map<string, number>();

  /** Attribute name → location, filled by a successful link. */
  readonly attribLocations = new Map<string, number>();

  /**
   * Every spelling `getUniformLocation` answers → its location record. Arrays
   * populate `name`, `name[0]`, and every `name[k]`, per the GL lookup rules.
   */
  readonly uniformLocations = new Map<string, UniformLocationObject>();

  /** The executable program a successful link produced; what the rasterizer runs. */
  executable: LinkedProgram | null = null;

  /**
   * The program's uniform values, flat f64 slots laid out by the linker.
   * Re-created zeroed on every successful re-link, per the GL rule that
   * linking resets uniforms to their initial values.
   */
  uniformStore: Float64Array | null = null;

  /**
   * Bumped on every successful link. A UniformLocationObject from an older
   * link carries the older number and is refused, per the GL rule that
   * re-linking invalidates previously fetched locations.
   */
  linkGeneration = 0;
}

/**
 * The opaque value `getUniformLocation` returns. It carries its program (so a
 * location used with a different program is refused, per GL), the element's
 * type and store slot (so the uniform setters can validate and write without
 * a lookup), and the link generation that minted it (so a stale location from
 * before a re-link is refused).
 */
export class UniformLocationObject {
  declare private readonly __brand: "headless-webgl2-uniform-location";

  readonly program: ProgramObject;

  /** The component offset in the program's uniform store this location writes at. */
  readonly slot: number;

  /** The element type (for an array location, one element's type). */
  readonly type: Type;

  /**
   * How many array elements remain from this location to the array's end
   * (1 for a non-array): the `uniform*v` forms may set this many at most.
   */
  readonly elementsRemaining: number;

  /**
   * True for a location inside a uniform array. It decides the *v setters'
   * multi-element rule: several elements at a non-array location is
   * INVALID_OPERATION, while data running past an array's end is ignored.
   */
  readonly partOfArray: boolean;

  /** The `linkGeneration` of the link that minted this location. */
  readonly generation: number;

  constructor(
    program: ProgramObject,
    slot: number,
    type: Type,
    elementsRemaining: number,
    partOfArray: boolean,
    generation: number,
  ) {
    this.program = program;
    this.slot = slot;
    this.type = type;
    this.elementsRemaining = elementsRemaining;
    this.partOfArray = partOfArray;
    this.generation = generation;
  }
}
