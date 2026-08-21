// The engine's draw-command recording format, as the console reads it.
//
// A recording is the list of operations a build issued against its 2D context,
// frame by frame, in the order it issued them (see
// `components/core/engines.md` and the engine package's own `recording.ts`).
// Replaying it re-issues those operations against a canvas of the console's own,
// so what a reviewer watches is the build's own drawing rather than a re-shoot of
// it — and, because every frame carries the context state it inherited, any frame
// can be drawn without drawing the frames before it.
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
// When the engine's recorder changes shape, bump `RECORDING_FORMAT` there, mirror
// the types here, and teach `parseRecording` which versions this console can still
// draw.

/**
 * The format version this console knows how to draw.
 *
 * A recording states the version it was written in, so a console that meets a
 * newer one refuses it by name instead of drawing a confident wrong picture from
 * fields it half-understands.
 */
export const RECORDING_FORMAT = 1;

/**
 * A value carried inside a recorded operation.
 *
 * Plain data travels as itself. `$ref` names a value an earlier recorded call
 * produced — how a gradient created through the context and then given colour
 * stops replays as the same gradient. `$opaque` names a value the recorder could
 * not carry, so a player skips the operation and says so rather than drawing
 * something else.
 */
export type DrawValue =
  | null
  | boolean
  | number
  | string
  | readonly DrawValue[]
  | { readonly $ref: number }
  | { readonly $opaque: string }
  | { readonly [key: string]: DrawValue };

/**
 * One recorded operation.
 *
 * `target` is absent for an operation the context performed and names an interned
 * value for an operation performed on something the context returned. `id` is
 * present when the call produced a value later operations refer to.
 */
export type DrawOp =
  | {
      readonly op: "call";
      readonly target?: number;
      readonly method: string;
      readonly args: readonly DrawValue[];
      readonly id?: number;
    }
  | {
      readonly op: "set";
      readonly target?: number;
      readonly property: string;
      readonly value: DrawValue;
    };

/**
 * The context state a frame inherited from the frame before it.
 *
 * This is what makes a frame independently renderable: a game that sets `font`
 * once relies on the context still carrying it a thousand frames later, and a
 * player that seeks straight to that frame has no earlier frame to have inherited
 * it from.
 */
export interface DrawState {
  /** The style properties in force, by name. */
  readonly properties: Readonly<Record<string, DrawValue>>;
  /** The transform as `[a, b, c, d, e, f]`, or `null` when unreadable. */
  readonly transform: readonly number[] | null;
  /** The dash pattern, or `null` when unreadable. */
  readonly lineDash: readonly number[] | null;
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
  /** The context state this frame inherited. */
  readonly state: DrawState;
  /** The operations this frame issued, in order. */
  readonly ops: readonly DrawOp[];
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

/** Whether a value is an array of real numbers, as a transform or dash is. */
function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber);
}

/**
 * Check one operation's shape.
 *
 * The operation's *values* are deliberately not walked: a `DrawValue` is any JSON
 * at all, and the two shapes that mean something to a player — `$ref` and
 * `$opaque` — are recognised while drawing, where a value that does not fit either
 * can be reported against the operation it appeared in. What is checked here is
 * the part a player dispatches on, so drawing never has to ask whether `method` is
 * really a string.
 *
 * Returns `null` when the operation is well formed, or what is wrong with it.
 */
function opProblem(value: unknown): string | null {
  if (!isRecord(value)) return "has an operation that is not an object";
  if (value.target !== undefined && !isNumber(value.target)) {
    return "has an operation naming a target that is not a number";
  }
  if (value.op === "call") {
    if (typeof value.method !== "string") {
      return "has a call with no method name";
    }
    if (!Array.isArray(value.args)) {
      return `has a call to ${value.method} with no arguments list`;
    }
    if (value.id !== undefined && !isNumber(value.id)) {
      return `has a call to ${value.method} with an id that is not a number`;
    }
    return null;
  }
  if (value.op === "set") {
    if (typeof value.property !== "string") {
      return "has an assignment with no property name";
    }
    if (!("value" in value)) {
      return `has an assignment to ${value.property} with no value`;
    }
    return null;
  }
  return `has an operation of an unknown kind (${JSON.stringify(value.op)})`;
}

/** Check one frame's shape, returning `null` or what is wrong with it. */
function frameProblem(value: unknown): string | null {
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
  const state = value.state;
  if (!isRecord(state) || !isRecord(state.properties)) {
    return "carries no inherited context state, so it cannot be drawn on its own";
  }
  if (state.transform !== null && !isNumberArray(state.transform)) {
    return "carries a transform that is not six numbers";
  }
  if (state.lineDash !== null && !isNumberArray(state.lineDash)) {
    return "carries a dash pattern that is not a list of numbers";
  }
  if (!Array.isArray(value.ops)) return "has no operations list";
  for (const op of value.ops) {
    const problem = opProblem(op);
    if (problem !== null) return problem;
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
 * dispatches on, so drawing a frame is total: it never has to ask whether the
 * thing it is about to replay is really an operation.
 */
export function parseRecording(data: unknown): RecordingParse {
  if (!isRecord(data)) {
    return {
      ok: false,
      message: "This file is not an engine replay — it is not a JSON object.",
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
    return {
      ok: false,
      message: `This replay was written in recording format ${data.format}, and this console plays format ${RECORDING_FORMAT}. Open the run in a newer console build to watch it.`,
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
  if (
    background !== null &&
    background !== undefined &&
    typeof background !== "string"
  ) {
    return {
      ok: false,
      message:
        "This replay's background is not a colour, so it cannot be played.",
    };
  }
  if (!Array.isArray(data.frames)) {
    return {
      ok: false,
      message: "This replay carries no frames, so there is nothing to play.",
    };
  }
  for (let i = 0; i < data.frames.length; i += 1) {
    const problem = frameProblem(data.frames[i]);
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
      background: background ?? null,
      frames: data.frames as readonly RecordedFrame[],
    },
  };
}

/**
 * The first two bytes of a gzip member (RFC 1952 §2.3.1).
 *
 * A JSON document never begins with them, so these two bytes tell a compressed
 * recording from a plain one with no ambiguity at all.
 */
const GZIP_MAGIC = [0x1f, 0x8b] as const;

/** Whether `body` is a gzip member rather than the document itself. */
function isGzip(body: ArrayBuffer): boolean {
  const head = new Uint8Array(
    body,
    0,
    Math.min(GZIP_MAGIC.length, body.byteLength),
  );
  return head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1];
}

/**
 * The JSON text of a fetched recording body, decompressing it when it arrived
 * compressed.
 *
 * A recording is stored and served gzipped, because the format is repetitive by
 * design — every frame restates the drawing state it inherited so that any frame
 * can be drawn on its own — and that redundancy compresses away almost entirely.
 * So the player decompresses rather than the format changing.
 *
 * Whether the bytes are still compressed when they arrive is not something this
 * side can decide, which is why it is sniffed rather than assumed. A host that
 * serves the file with `Content-Encoding: gzip` has the browser inflate the body
 * before any script sees it, and a host that serves it as the gzip document it is
 * hands it over untouched. Both are legitimate, and the reviewer must be able to
 * watch the replay either way, so the two bytes that open a gzip member decide it
 * for each response on its own.
 */
async function recordingText(body: ArrayBuffer): Promise<string> {
  if (!isGzip(body)) return new TextDecoder().decode(body);
  const compressed = new Response(body).body;
  if (compressed === null) {
    throw new Error("The replay arrived empty, so it cannot be played.");
  }
  try {
    return await new Response(
      compressed.pipeThrough(new DecompressionStream("gzip")),
    ).text();
  } catch {
    throw new Error(
      "The replay is compressed with something this console cannot read, so it cannot be played.",
    );
  }
}

/**
 * Fetch a recording and read it, or throw a sentence fit to show the reviewer.
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
  const text = await recordingText(await response.arrayBuffer());
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The replay is not valid JSON, so it cannot be played.");
  }
  const parsed = parseRecording(data);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.recording;
}
