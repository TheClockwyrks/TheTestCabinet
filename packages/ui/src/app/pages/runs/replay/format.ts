// The engine's draw-command recording format, as the console reads it.
//
// A recording is the list of operations a build issued against its 2D context,
// frame by frame, in the order it issued them (see
// `components/core/engines.md` and the engine package's own `recording.ts`).
// Replaying it re-issues those operations against a canvas of the console's own,
// so what a reviewer watches is the build's own drawing rather than a re-shoot of
// it — and, because a frame carries the context state it inherited and names
// everything else it needs in tables the whole recording shares, any frame can be
// drawn without drawing the frames before it.
//
// These declarations are a deliberate, structurally identical COPY of
// `packages/simple-2d/src/contract.ts`, not an import of it. The engine package is
// vendored into a run repo and has to stay self-contained — the console taking a
// dependency on it would tie the two release cycles together, and a console built
// today has to read a recording produced by an engine build it has never seen.
// The `format` number below is the contract between them, which is exactly why a
// player checks it before it draws anything. The Foray replay renderer next door
// carries its own copy of the case's engine for the same reason.
//
// There is one recording format and it is version 1. When the engine's recorder
// changes shape, the types here change with it; a player never learns to read a
// second shape.

/**
 * The format version this console knows how to draw.
 *
 * A recording states the version it was written in, so a console that meets a
 * document stating anything else refuses it by name instead of drawing a confident
 * wrong picture from fields it half-understands.
 */
export const RECORDING_FORMAT = 1;

/**
 * A value carried inside a recorded operation.
 *
 * Plain data travels as itself. `$res` names a value the context produced — a
 * gradient, a pattern — as the recipe that rebuilds it, and `$img` names a bitmap
 * or pixel buffer the recorder captured, so a fill and a sprite both resolve
 * wherever a reviewer lands. `$opaque` names a value the recorder could not carry
 * at all, so a player skips the operation and says so rather than drawing
 * something else.
 */
export type DrawValue =
  | null
  | boolean
  | number
  | string
  | readonly DrawValue[]
  | { readonly $res: number }
  | { readonly $img: number }
  | { readonly $opaque: string }
  | { readonly [key: string]: DrawValue };

/**
 * One recorded operation.
 *
 * Every entry of a recording's `ops` is an operation the context itself performed.
 * An operation performed on a value the context returned belongs to that value's
 * `Resource` recipe instead, so a player issues each of these against the context
 * it is drawing into and has nothing else to dispatch on.
 */
export type DrawOp =
  | {
      readonly op: "call";
      readonly method: string;
      readonly args: readonly DrawValue[];
    }
  | {
      readonly op: "set";
      readonly property: string;
      readonly value: DrawValue;
    };

/** One step in a resource's recipe, applied to the value the context returned. */
export type ResourceOp = DrawOp;

/**
 * A value the context produced, carried as the recipe that rebuilds it.
 *
 * A gradient is bound to the context that created it, so it cannot be carried as
 * a value at all: what travels is the creating call plus the mutations made on it
 * before this use. The recipe is taken at the moment of use, so a gradient that is
 * filled, given another colour stop, and filled again names two resources and each
 * fill replays under the stops it actually had.
 */
export interface Resource {
  /** The context call that created the value. */
  readonly make: {
    readonly method: string;
    readonly args: readonly DrawValue[];
  };
  /** The calls and assignments made on the value before this use, in order. */
  readonly then: readonly ResourceOp[];
}

/**
 * A bitmap or pixel buffer the operations draw.
 *
 * A `bitmap` entry rebuilds where a `CanvasImageSource` is expected — `drawImage`,
 * `createPattern` — from a PNG, which a browser decodes asynchronously, so the
 * whole table is prepared before playback starts rather than during a draw.
 *
 * A `pixels` entry rebuilds as the `ImageData` a `putImageData` writes, and it
 * carries its RGBA bytes rather than a PNG. The canvas round trip a PNG would need
 * is lossy: drawing an image into a canvas premultiplies each colour channel by
 * the pixel's alpha and reading it back un-premultiplies it, so a partly
 * transparent pixel is quantised to eight bits twice and comes back a different
 * colour. `ImageData` is the one kind of image a check compares byte for byte, so
 * it travels byte for byte and is rebuilt with no decoder at all.
 */
export type CapturedImage =
  | {
      /** How the value is rebuilt: as an image a context can draw. */
      readonly kind: "bitmap";
      /** The captured width in pixels. */
      readonly width: number;
      /** The captured height in pixels. */
      readonly height: number;
      /** A `data:image/png;base64,…` URL holding the pixels. */
      readonly src: string;
    }
  | {
      /** How the value is rebuilt: as `ImageData`. */
      readonly kind: "pixels";
      /** The captured width in pixels. */
      readonly width: number;
      /** The captured height in pixels. */
      readonly height: number;
      /** The RGBA bytes, base64 encoded, four bytes per pixel in row order. */
      readonly data: string;
    };

/**
 * One run of path operations the context issued under one transform.
 *
 * A canvas reports neither its clip region nor its current path, so both travel as
 * the operations that built them. Clips intersect rather than replace, so a state
 * carries one segment per `clip` call still in force and a player applies them in
 * turn; the current path carries the operations issued since the last `beginPath`.
 * A path is given in user space, so each segment carries the transform that was in
 * force when its operations were issued — replaying them under the frame's own
 * transform would clip, or draw, a different region.
 */
export interface PathSegment {
  /** The transform as `[a, b, c, d, e, f]`, or `null` when unreadable. */
  readonly transform: readonly number[] | null;
  /** The path operations issued under that transform, in order. */
  readonly ops: readonly DrawOp[];
}

/**
 * The context state a frame inherited from the frame before it.
 *
 * This is part of what makes a frame independently renderable: a game that sets
 * `font` once relies on the context still carrying it a thousand frames later, and
 * a player that seeks straight to that frame has no earlier frame to have
 * inherited it from. A property holding a gradient or a pattern carries a `$res`,
 * which resolves from the recording's own table, so the inherited fill is the fill
 * the build drew under.
 */
export interface DrawState {
  /** The style properties in force, by name. */
  readonly properties: Readonly<Record<string, DrawValue>>;
  /** The transform as `[a, b, c, d, e, f]`, or `null` when unreadable. */
  readonly transform: readonly number[] | null;
  /** The dash pattern, or `null` when unreadable. */
  readonly lineDash: readonly number[] | null;
  /** The clip region in force, as the segments that built it, in order. */
  readonly clip: readonly PathSegment[];
  /**
   * The current path, as the operations issued since the last `beginPath`.
   *
   * A canvas keeps its current path across a frame boundary, so a build is free to
   * open a path on one frame and fill it on the next. Carrying it is also what
   * makes an inherited clip safe: replaying a clip segment's path leaves the clip
   * outline current, so a player issues `beginPath` between the clip and this and
   * a bare `fill` among the frame's operations fills the path the build had rather
   * than the outline of its clip.
   */
  readonly path: readonly PathSegment[];
}

/** One frame of a recording. */
export interface RecordedFrame {
  /** The engine's frame counter at this frame. */
  readonly count: number;
  /** Accumulated simulated time through this frame, in milliseconds. */
  readonly timeMs: number;
  /** What this frame was worth, in milliseconds. */
  readonly deltaMs: number;
  /** The canvas backing store this frame was drawn into, in device pixels. */
  readonly surface: { readonly width: number; readonly height: number };
  /** Index into the recording's `states` of the state this frame inherited. */
  readonly state: number;
  /**
   * Indices into the recording's `states` of the states saved under it, outermost
   * first.
   *
   * A build may `save()` on one frame and `restore()` on the next, so the stack of
   * saved states survives a frame boundary along with the state on top of it. A
   * player pushes these before the frame's own state, which is what makes a
   * `restore()` among the frame's operations return to the state the build
   * returned to.
   */
  readonly stack: readonly number[];
  /** Indices into the recording's `ops`, in the order the frame issued them. */
  readonly ops: readonly number[];
  /**
   * Whether part of what this frame inherited was too large for the format to
   * carry, and was cut down to the bound.
   *
   * The save stack, the clip region and the current path are each shadowed by the
   * recorder and each bounded, because a build that saves without restoring, or
   * that never calls `beginPath`, would otherwise cost more at every frame open
   * for the rest of the recording. Past a bound the recorder keeps what a
   * following operation can still reach and drops the rest, so the frame replays
   * under a state that is close to the build's rather than equal to it.
   *
   * A reviewer has to be able to tell a picture the format could not carry from
   * one it carried, so a frame that was cut down says so and the player reports it
   * beside everything else it could not reproduce. Present only when something was
   * in fact cut down: the flag names an exceptional frame, and writing `false` on
   * every frame of a fifty-thousand-frame recording would cost bytes to say
   * nothing.
   */
  readonly truncated?: boolean;
}

/** A recorded run of frames. */
export interface Recording {
  /** The format version a player checks before drawing anything. */
  readonly format: number;
  /** The logical design width the operations were issued in. */
  readonly width: number;
  /** The logical design height the operations were issued in. */
  readonly height: number;
  /** The colour each frame was cleared to, or `null` for transparency. */
  readonly background: string | null;
  /** The bitmaps and pixel buffers the operations draw, by index. */
  readonly images: readonly CapturedImage[];
  /** The values the context produced and the operations draw with, by index. */
  readonly resources: readonly Resource[];
  /** Every distinct operation the recording holds, by index. */
  readonly ops: readonly DrawOp[];
  /** Every distinct inherited state block, by index. */
  readonly states: readonly DrawState[];
  /** The frames captured, in order. */
  readonly frames: readonly RecordedFrame[];
}

/**
 * The outcome of reading a file that claims to be a recording.
 *
 * A refusal carries a sentence written for the reviewer looking at the run, not a
 * stack trace: they can act on "this console is too old for this replay" and can
 * do nothing at all with "unexpected token".
 */
export type RecordingParse =
  | { readonly ok: true; readonly recording: Recording }
  | { readonly ok: false; readonly message: string };

/** Whether a value is a plain JSON object (and so may carry named fields). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value is a real number — JSON's `null`, strings and NaN are not. */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Whether a value is an array of real numbers, as a dash pattern is. */
function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber);
}

/**
 * Whether a value is a transform: `[a, b, c, d, e, f]`, and nothing else.
 *
 * The length is checked here rather than at the point of use because a transform
 * of any other length cannot be applied at all — a player that met one could only
 * drop it and draw the frame under whatever transform preceded it, which is the
 * wrong picture reported as a clean one.
 */
function isTransform(value: unknown): value is number[] {
  return isNumberArray(value) && value.length === 6;
}

/**
 * How many states a frame's inherited save stack may name.
 *
 * A fixed part of the format rather than a choice either side makes: the recorder
 * keeps the innermost entries and drops the rest, because a `restore` pops the
 * innermost first and those are the ones a frame's own operations can still reach.
 *
 * The parser enforces it for the same reason it enforces the nesting bound —
 * nothing a recorder writes is refused by it, and what it protects against is a
 * document this console did not write. Every entry of a two-hundred-thousand-entry
 * stack can be a valid index and the frame is still undrawable in practice: the
 * player applies a state and pushes a level per entry, which is six and a half
 * seconds inside one `drawFrame`, with the reviewer's tab frozen for all of it.
 * Checking each index and not the count leaves that whole cost in range.
 */
const SAVE_STACK = 64;

/**
 * How many segments a state's clip region, and its current path, may each carry.
 *
 * A fixed part of the format rather than a choice either side makes: a recorder
 * bounds each of the two at 1024 path operations and opens a segment only to hold
 * one, so a shadow at its bound is at most 1024 segments and nothing a recorder
 * writes is refused here.
 *
 * Enforced for the same reason the save stack's bound is, and against the same
 * cost. Every segment of a two-hundred-thousand-segment clip can be well formed
 * and the state is still unusable in practice: applying one sets a transform and
 * re-issues a path, and a clip INTERSECTS rather than replaces, so the whole of
 * that is paid inside one `drawFrame` with the reviewer's tab frozen for all of
 * it — and paid again on every frame that inherits the state. Checking each
 * segment's shape and not the count leaves that cost in range.
 */
const PATH_SEGMENTS = 1024;

/** Whether a value is an index into a table of `length` entries. */
function isIndex(value: unknown, length: number): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) < length
  );
}

/**
 * Check one operation's shape.
 *
 * The operation's *values* are deliberately not walked: a `DrawValue` is any JSON
 * at all, and the three shapes that mean something to a player — `$res`, `$img`
 * and `$opaque` — are recognised while drawing, where one that names a table entry
 * this recording does not carry can be reported against the operation it appeared
 * in, beside the frame it cost. What is checked here is the part a player
 * dispatches on, so drawing never has to ask whether `method` is really a string.
 *
 * Returns `null` when the operation is well formed, or what is wrong with it,
 * phrased to follow whatever names it ("operation 5 …", "resource 2 has a step
 * that …").
 */
function opProblem(value: unknown): string | null {
  if (!isRecord(value)) return "is not an object";
  if (value.op === "call") {
    if (typeof value.method !== "string") {
      return "is a call with no method name";
    }
    if (!Array.isArray(value.args)) {
      return `is a call to ${value.method} with no arguments list`;
    }
    return null;
  }
  if (value.op === "set") {
    if (typeof value.property !== "string") {
      return "is an assignment with no property name";
    }
    if (!("value" in value)) {
      return `is an assignment to ${value.property} with no value`;
    }
    return null;
  }
  return `is of an unknown kind (${JSON.stringify(value.op)})`;
}

/**
 * Check one path segment — of a clip region or of a current path — returning
 * `null` or what is wrong with it.
 *
 * A segment is replayed exactly as a frame's own operations are — its path is
 * issued against the context under its own transform — so it is checked exactly as
 * they are.
 */
function segmentProblem(value: unknown): string | null {
  if (!isRecord(value)) return "is not an object";
  if (value.transform !== null && !isTransform(value.transform)) {
    return "was issued under a transform that is not six numbers";
  }
  if (!Array.isArray(value.ops)) return "carries no path";
  for (const op of value.ops) {
    const problem = opProblem(op);
    if (problem !== null) return `carries an operation that ${problem}`;
  }
  return null;
}

/** Check one inherited state block, returning `null` or what is wrong with it. */
function stateProblem(value: unknown): string | null {
  if (!isRecord(value)) return "is not an object";
  if (!isRecord(value.properties)) return "lists no style properties";
  if (value.transform !== null && !isTransform(value.transform)) {
    return "carries a transform that is not six numbers";
  }
  if (value.lineDash !== null && !isNumberArray(value.lineDash)) {
    return "carries a dash pattern that is not a list of numbers";
  }
  if (!Array.isArray(value.clip)) return "carries no clip region";
  if (value.clip.length > PATH_SEGMENTS) {
    return `carries ${value.clip.length} clip segments, more than the ${PATH_SEGMENTS} this format carries, so it was not written by a recorder`;
  }
  for (let i = 0; i < value.clip.length; i += 1) {
    const problem = segmentProblem(value.clip[i]);
    if (problem !== null) return `has a clip segment (${i}) that ${problem}`;
  }
  // The current path is checked as strictly as the clip. A state that carried none
  // would leave a player with nothing to put in force between a clip's outline and
  // the frame's first bare `fill`, which is the shape that fills the clip region
  // instead of the rectangle the build drew.
  if (!Array.isArray(value.path)) return "carries no current path";
  if (value.path.length > PATH_SEGMENTS) {
    return `carries ${value.path.length} path segments, more than the ${PATH_SEGMENTS} this format carries, so it was not written by a recorder`;
  }
  for (let i = 0; i < value.path.length; i += 1) {
    const problem = segmentProblem(value.path[i]);
    if (problem !== null) return `has a path segment (${i}) that ${problem}`;
  }
  return null;
}

/** Check one captured image, returning `null` or what is wrong with it. */
function imageProblem(value: unknown): string | null {
  if (!isRecord(value)) return "is not an object";
  if (value.kind !== "bitmap" && value.kind !== "pixels") {
    return `does not say how it is rebuilt (${JSON.stringify(value.kind)})`;
  }
  if (!isNumber(value.width) || !isNumber(value.height)) {
    return "does not say what size it is";
  }
  // The two kinds carry their pixels in different fields, and which field is
  // checked is the whole of what `kind` decides here: a `bitmap` is a PNG a browser
  // decodes, a `pixels` entry is the RGBA bytes themselves.
  if (value.kind === "bitmap" && typeof value.src !== "string") {
    return "carries no pixels";
  }
  if (value.kind === "pixels" && typeof value.data !== "string") {
    return "carries no pixels";
  }
  return null;
}

/**
 * The context calls that produce a value a recipe can rebuild.
 *
 * A recipe is re-issued against the context a player is drawing into, which is
 * faithful only for a call whose answer does not depend on that context's state.
 * These four are the whole of that set, and a document naming any other call is
 * refused: a `getTransform()` accepted here would have the player paint the rest
 * of the frame under whatever this context happened to answer and report the frame
 * as clean.
 */
const PRODUCING_METHODS: readonly string[] = [
  "createLinearGradient",
  "createRadialGradient",
  "createConicGradient",
  "createPattern",
];

/** Check one resource recipe, returning `null` or what is wrong with it. */
function resourceProblem(value: unknown): string | null {
  if (!isRecord(value)) return "is not an object";
  const make = value.make;
  if (!isRecord(make)) return "does not say what call created it";
  if (typeof make.method !== "string") {
    return "was created by a call with no method name";
  }
  if (!PRODUCING_METHODS.includes(make.method)) {
    return `names ${make.method} as the call that created it, which does not produce a value this player may rebuild`;
  }
  if (!Array.isArray(make.args)) {
    return `was created by a call to ${make.method} with no arguments list`;
  }
  if (!Array.isArray(value.then)) return "carries no list of steps";
  for (const step of value.then) {
    const problem = opProblem(step);
    if (problem !== null) return `has a step that ${problem}`;
  }
  return null;
}

/**
 * Check one frame's shape against the tables it indexes into.
 *
 * An index outside a table is as damaging as a malformed operation and is reported
 * the same way: the frame names something the recording does not carry, so the
 * picture it would draw is not the one that was recorded.
 */
function frameProblem(
  value: unknown,
  states: number,
  ops: number,
): string | null {
  if (!isRecord(value)) return "is not an object";
  if (!isNumber(value.count)) return "has no frame counter";
  if (!isNumber(value.timeMs) || !isNumber(value.deltaMs)) {
    return "has no timing";
  }
  const surface = value.surface;
  if (
    !isRecord(surface) ||
    !isNumber(surface.width) ||
    !isNumber(surface.height)
  ) {
    return "does not say what surface it was drawn into";
  }
  if (!isIndex(value.state, states)) {
    return `names inherited state ${JSON.stringify(value.state)}, which this replay does not carry, so it cannot be drawn on its own`;
  }
  if (!Array.isArray(value.stack)) return "does not say what it had saved";
  if (value.stack.length > SAVE_STACK) {
    return `names ${value.stack.length} saved states, more than the ${SAVE_STACK} this format carries, so it was not written by a recorder`;
  }
  for (const index of value.stack) {
    if (!isIndex(index, states)) {
      return `names saved state ${JSON.stringify(index)}, which this replay does not carry, so a restore in it cannot be replayed`;
    }
  }
  if (!Array.isArray(value.ops)) return "has no operations list";
  for (const index of value.ops) {
    if (!isIndex(index, ops)) {
      return `names operation ${JSON.stringify(index)}, which this replay does not carry`;
    }
  }
  // Absent on every frame the recorder had room for, so it is checked only when it
  // is there. A frame carrying something else under the name is a document that
  // means something by it this player does not, which is the case the shape checks
  // exist to catch.
  if (value.truncated !== undefined && typeof value.truncated !== "boolean") {
    return `says it was truncated as ${JSON.stringify(value.truncated)}, which is neither true nor absent`;
  }
  return null;
}

/**
 * Read a parsed JSON value as a recording, or refuse it.
 *
 * The version check comes first and is absolute: a recording written in a format
 * this console does not know is refused whole rather than drawn from whichever
 * fields happen to still line up. Showing a reviewer nothing costs them a replay;
 * showing them a picture assembled from a format we guessed at costs them the
 * verdict they base on it.
 *
 * Everything after the version check is a shape check over the fields a player
 * dispatches on — the shared tables, and each frame's indices into them — so
 * drawing a frame is total: it never has to ask whether the thing it is about to
 * replay is really an operation.
 */
export function parseRecording(data: unknown): RecordingParse {
  if (!isRecord(data)) {
    return {
      ok: false,
      message: "This file is not an engine replay: it is not a JSON object.",
    };
  }
  if (!isNumber(data.format)) {
    return {
      ok: false,
      message:
        "This file does not say which recording format it was written in, so it cannot be played. It was probably not produced by an engine recorder.",
    };
  }
  if (data.format !== RECORDING_FORMAT) {
    // There is one recording format, so a document stating another number was not
    // written by an engine recorder — there is no older shape to fall back to and
    // no newer console that would play it.
    return {
      ok: false,
      message: `This file states recording format ${data.format}, and the only recording format is ${RECORDING_FORMAT}, so it was not produced by an engine recorder.`,
    };
  }
  if (!isNumber(data.width) || !isNumber(data.height)) {
    return {
      ok: false,
      message:
        "This replay does not say what size it was drawn at, so it cannot be played.",
    };
  }
  const background = data.background;
  // Transparency is written as an explicit `null`, so an absent field is a
  // document that does not state what its frames were cleared to rather than one
  // saying they were cleared to nothing. Reading the two as the same thing draws
  // every frame of a recording that lost the field over a transparent page, which
  // is a different picture told as a clean one.
  if (background === undefined) {
    return {
      ok: false,
      message:
        "This replay does not say what its frames were cleared to, so it cannot be played.",
    };
  }
  if (background !== null && typeof background !== "string") {
    return {
      ok: false,
      message:
        "This replay's background is not a colour, so it cannot be played.",
    };
  }

  // The tables come before the frames, because a frame is checked against their
  // lengths: an index is only in range once there is a table to be in range of.
  const tables: Array<[string, unknown, (entry: unknown) => string | null]> = [
    ["image", data.images, imageProblem],
    ["resource", data.resources, resourceProblem],
    ["operation", data.ops, opProblem],
    ["state", data.states, stateProblem],
  ];
  for (const [noun, table, problemOf] of tables) {
    if (!Array.isArray(table)) {
      return {
        ok: false,
        message: `This replay is damaged: it carries no ${noun} table, so its frames cannot be drawn.`,
      };
    }
    for (let i = 0; i < table.length; i += 1) {
      const problem = problemOf(table[i]);
      if (problem !== null) {
        return {
          ok: false,
          message: `This replay is damaged: ${noun} ${i} ${problem}.`,
        };
      }
    }
  }

  if (!Array.isArray(data.frames)) {
    return {
      ok: false,
      message: "This replay carries no frames, so there is nothing to play.",
    };
  }
  const states = data.states as unknown[];
  const ops = data.ops as unknown[];
  for (let i = 0; i < data.frames.length; i += 1) {
    const problem = frameProblem(data.frames[i], states.length, ops.length);
    if (problem !== null) {
      return {
        ok: false,
        message: `This replay is damaged: frame ${i} ${problem}.`,
      };
    }
  }

  return {
    ok: true,
    recording: {
      format: data.format,
      width: data.width,
      height: data.height,
      background,
      images: data.images as readonly CapturedImage[],
      resources: data.resources as readonly Resource[],
      ops: ops as readonly DrawOp[],
      states: states as readonly DrawState[],
      frames: data.frames as readonly RecordedFrame[],
    },
  };
}

/**
 * Fetch a recording and read it, or throw a sentence fit to show the reviewer.
 *
 * A recording is stored and served gzipped, because a document of coordinates and
 * repeated method names compresses to a fraction of its size and it is the
 * reviewer's browser that pays to move and parse it. Every host that serves one
 * declares it: `Content-Type: application/json` with `Content-Encoding: gzip`. So
 * the browser inflates the body before any script sees it and the player reads the
 * JSON straight off the response.
 *
 * The status is checked before the body is parsed for the same reason the
 * adversarial player checks it: a 404's error body is valid JSON, and handing it
 * on unchecked reports a missing file as a damaged replay.
 */
export async function fetchRecording(url: string): Promise<Recording> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `The replay could not be fetched (HTTP ${response.status}).`,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("The replay is not valid JSON, so it cannot be played.");
  }
  const parsed = parseRecording(data);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.recording;
}
