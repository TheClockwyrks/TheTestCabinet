// Drawing one frame of a recording onto a 2D context.
//
// The whole of the player's drawing is here, and it is deliberately a pure
// function of (context, recording, frame): it takes the frame it is asked for,
// applies the context state that frame inherited, and re-issues that frame's
// operations. It NEVER replays the frames before it. That is not an optimisation
// — it is the property the format was shaped to provide, and everything the
// reviewer's player does rests on it: seeking to frame 900 costs the same as
// seeking to frame 3, and two recordings can be scrubbed side by side in step
// because moving both to frame N is two independent draws rather than two
// re-simulations that have to be kept aligned.
//
// What a frame cannot always carry is a value the recorder interned: the recorder
// gives a gradient an id the first time the context hands it over and writes every
// later use of it as a reference to that id, so a gradient created on frame 1 and
// re-used on frame 900 reaches us on frame 900 as a reference to an operation this
// frame does not contain. Such an operation is skipped and counted rather than
// guessed at, so the player can tell the reviewer which part of the picture is
// missing instead of quietly drawing it in the wrong colour.

import type {
  DrawOp,
  DrawState,
  DrawValue,
  RecordedFrame,
  Recording,
} from "./format";

/**
 * What one frame's draw did, and what it could not do.
 *
 * The counts are per frame rather than per recording because that is the honest
 * unit: an operation the player cannot reproduce is missing from *this* picture,
 * and the frame beside it may be complete. `unreproducible` holds each distinct
 * reason once, in the order first met, so the note under a canvas names what is
 * missing ("CanvasPattern") rather than repeating it two hundred times.
 */
export interface ReplayFrameReport {
  /** Operations re-issued against the context. */
  readonly drawn: number;
  /** Operations, and inherited state properties, that could not be reproduced. */
  readonly skipped: number;
  /** Each distinct reason something was skipped, in the order first met. */
  readonly unreproducible: readonly string[];
}

/** A value resolved against this frame's interned values, or why it could not be. */
type Resolution =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * What to say about a reference this frame cannot resolve.
 *
 * Phrased as the cause rather than as the mechanism, because a reviewer reads it:
 * the value was made by an operation that happened before the frame they are
 * looking at, which is why it is not here.
 */
const EARLIER_VALUE = "a value created before this frame";

/**
 * Resolve one recorded value into something a context can be handed.
 *
 * Plain data resolves to itself, a `$ref` to the interned value it names, and an
 * `$opaque` to a refusal carrying the type the recorder could not carry. Arrays
 * and objects resolve element by element and fail whole: an argument bag with one
 * unreproducible field in it would make the call mean something different, so the
 * call is skipped rather than issued with a hole in it.
 */
function resolve(
  value: DrawValue,
  interned: ReadonlyMap<number, unknown>,
): Resolution {
  if (value === null || typeof value !== "object") return { ok: true, value };

  if (Array.isArray(value)) {
    const resolved: unknown[] = [];
    for (const entry of value as readonly DrawValue[]) {
      const element = resolve(entry, interned);
      if (!element.ok) return element;
      resolved.push(element.value);
    }
    return { ok: true, value: resolved };
  }

  const record = value as { readonly [key: string]: DrawValue };
  if ("$opaque" in record) {
    const name = record.$opaque;
    return {
      ok: false,
      reason: typeof name === "string" ? name : "an unrecordable value",
    };
  }
  if ("$ref" in record) {
    const id = record.$ref;
    if (typeof id !== "number") return { ok: false, reason: EARLIER_VALUE };
    if (!interned.has(id)) return { ok: false, reason: EARLIER_VALUE };
    return { ok: true, value: interned.get(id) };
  }

  const resolved: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    const field = resolve(entry, interned);
    if (!field.ok) return field;
    resolved[key] = field.value;
  }
  return { ok: true, value: resolved };
}

/**
 * Wipe the context back to a blank page before the frame is applied to it.
 *
 * `reset` is used where the context offers it, because it restores *every* piece
 * of state to its default — so a property the frame's inherited state happens not
 * to mention cannot leak in from whatever was drawn here before. Where it is
 * absent (an older engine, and the hand-written contexts the tests drive) the
 * transform is cleared and the surface wiped by hand, which is the part that
 * matters: the frame's own state and operations overwrite the rest.
 *
 * The surface wiped is the context's own backing store where there is one, and the
 * surface the frame was recorded into otherwise — the player sizes the canvas from
 * exactly that, so the two agree.
 */
function blank(
  ctx: CanvasRenderingContext2D,
  recording: Recording,
  frame: RecordedFrame,
): void {
  const resettable = ctx as CanvasRenderingContext2D & { reset?: () => void };
  if (typeof resettable.reset === "function") resettable.reset();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const canvas = ctx.canvas as HTMLCanvasElement | undefined;
  const width = canvas?.width ?? frame.surface.width;
  const height = canvas?.height ?? frame.surface.height;
  ctx.clearRect(0, 0, width, height);
  // The recorded frame clears (or fills) its own background as its first operation
  // — the engine does that before the game draws — so this is not what makes the
  // picture right. It is what keeps a recording whose first operations were lost to
  // an unreproducible value from being read against the page underneath it.
  if (recording.background !== null) {
    ctx.fillStyle = recording.background;
    ctx.fillRect(0, 0, width, height);
  }
}

/**
 * Apply the context state a frame inherited: properties, then the transform, then
 * the dash pattern.
 *
 * The order is the format's, and it is load-bearing in one place: `setTransform`
 * replaces the transform outright, so it has to follow anything that might have
 * disturbed it rather than precede it.
 *
 * A property whose value cannot be resolved is left at its default instead of
 * being assigned a guess, and is counted — a frame drawn under the wrong fill is a
 * frame that lies quietly, which is the one outcome worth refusing.
 */
function applyState(
  ctx: CanvasRenderingContext2D,
  state: DrawState,
  interned: ReadonlyMap<number, unknown>,
  skip: (reason: string) => void,
): void {
  const properties = ctx as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(state.properties)) {
    const resolved = resolve(value, interned);
    if (!resolved.ok) {
      skip(resolved.reason);
      continue;
    }
    try {
      properties[name] = resolved.value;
    } catch {
      // A context that refuses a property it does not implement is telling us the
      // property does not apply to it. The recorder is equally forgiving on the way
      // in, so a recording taken on one context and drawn on another meets this.
      skip(`the ${name} property`);
    }
  }

  if (state.transform !== null && state.transform.length === 6) {
    const [a, b, c, d, e, f] = state.transform as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    ctx.setTransform(a, b, c, d, e, f);
  }
  if (state.lineDash !== null) ctx.setLineDash([...state.lineDash]);
}

/**
 * Re-issue one operation.
 *
 * Returns `null` when it was issued, or the reason it was not. The target is the
 * context itself for an operation the context performed, and the interned value
 * for an operation performed on something the context returned — the same
 * distinction the recorder wrote down.
 */
function issue(
  ctx: CanvasRenderingContext2D,
  op: DrawOp,
  interned: Map<number, unknown>,
): string | null {
  let subject: unknown = ctx;
  if (op.target !== undefined) {
    if (!interned.has(op.target)) return EARLIER_VALUE;
    subject = interned.get(op.target);
  }
  if (subject === null || typeof subject !== "object") return EARLIER_VALUE;
  const host = subject as Record<string, unknown>;

  if (op.op === "set") {
    const value = resolve(op.value, interned);
    if (!value.ok) return value.reason;
    try {
      host[op.property] = value.value;
    } catch {
      return `the ${op.property} property`;
    }
    return null;
  }

  // The arguments are resolved before the method is looked up, so a call carrying a
  // value the recorder could not carry is reported by that value's own name rather
  // than by whichever context happens to be drawing it — the cause is in the
  // recording either way, and the recorder's label is the one that says what is
  // missing from the picture.
  const args: unknown[] = [];
  for (const arg of op.args) {
    const resolved = resolve(arg, interned);
    if (!resolved.ok) return resolved.reason;
    args.push(resolved.value);
  }
  const method = host[op.method];
  if (typeof method !== "function") return `${op.method}()`;
  let result: unknown;
  try {
    result = (method as (...rest: unknown[]) => unknown).apply(subject, args);
  } catch {
    // One operation a context rejects — an image drawn from a source it will not
    // take, a font it cannot parse — must not cost the reviewer the rest of the
    // frame. It is reported the same way an unreproducible value is.
    return `${op.method}()`;
  }
  // Intern whatever the call produced, under the id the recording gave it, so the
  // operations that follow it in THIS frame can name it. Ids are per recording
  // rather than per frame, which is why the map is built fresh for each frame and
  // a reference to an id this frame did not produce resolves to nothing.
  if (op.id !== undefined) interned.set(op.id, result);
  return null;
}

/**
 * Draw one frame of a recording onto a context.
 *
 * `frame` is an index into `recording.frames`; an index outside it draws nothing
 * and reports nothing, which is how a pane holds its last frame while the pane
 * beside it plays on.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  recording: Recording,
  frame: number,
): ReplayFrameReport {
  const shot = recording.frames[frame];
  if (shot === undefined) return { drawn: 0, skipped: 0, unreproducible: [] };

  let skipped = 0;
  const unreproducible: string[] = [];
  const skip = (reason: string): void => {
    skipped += 1;
    if (!unreproducible.includes(reason)) unreproducible.push(reason);
  };

  // Built fresh for this frame, and only from this frame's own operations: an id
  // is only resolvable here if the call that produced it is one of the calls being
  // replayed. See the note at the top of the file.
  const interned = new Map<number, unknown>();

  blank(ctx, recording, shot);
  applyState(ctx, shot.state, interned, skip);

  let drawn = 0;
  for (const op of shot.ops) {
    const reason = issue(ctx, op, interned);
    if (reason === null) drawn += 1;
    else skip(reason);
  }

  return { drawn, skipped, unreproducible };
}
