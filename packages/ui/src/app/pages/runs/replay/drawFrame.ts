// Drawing one frame of a recording onto a 2D context.
//
// The whole of the player's drawing is here, and it is deliberately a pure
// function of (context, recording, resources, frame): it takes the frame it is
// asked for, applies the context state that frame inherited, and re-issues that
// frame's operations. It NEVER replays the frames before it. That is not an
// optimisation — it is the property the format was shaped to provide, and
// everything the reviewer's player does rests on it: seeking to frame 900 costs
// the same as seeking to frame 3, and two recordings can be scrubbed side by side
// in step because moving both to frame N is two independent draws rather than two
// re-simulations that have to be kept aligned.
//
// What a frame inherits is the whole of the context it opened with: the state on
// top, the states saved under it, the clip region in force, and the current path.
// All four are re-established here before the frame's own operations, so a
// `restore()` the frame issues pops to the state the build popped to, a clip set on
// an earlier frame still confines this one, and a path opened on an earlier frame is
// the path a bare `fill()` fills.
//
// A frame refers to two kinds of value it cannot carry inline, and both resolve
// from tables the whole recording shares rather than from the frames around it:
//
//   * A value the context produced — a gradient, a pattern — travels as the recipe
//     that rebuilds it. It has to be REBUILT rather than looked up, because such a
//     value is bound to the context that created it, so the recipe is issued
//     against the context being drawn into and the result is memoised for the rest
//     of this frame. A gradient created on frame 1 and left in force is therefore
//     drawn on frame 900 under the stops it actually had.
//   * A bitmap travels as a PNG data URL. Decoding one is asynchronous and drawing
//     a frame is not, so the whole table is decoded once by `prepareRecording` and
//     handed in here already decoded. A pixel buffer travels as its own RGBA bytes
//     and is rebuilt from them, exactly, with no decoder in the way.
//
// What still cannot be reproduced — a value the recorder could not carry at all, a
// method this context does not have, an image that would not decode — is skipped
// and counted rather than guessed at, so the player can tell the reviewer which
// part of the picture is missing instead of quietly drawing it in the wrong
// colour.

import type {
  CapturedImage,
  DrawOp,
  DrawState,
  DrawValue,
  PathSegment,
  RecordedFrame,
  Recording,
  Resource,
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
  /**
   * Everything that could not be reproduced, whatever part of the frame it was.
   *
   * This counts the frame's own operations, and also the parts of the state it
   * inherited: a style property, a step of a clip or a path segment, a transform,
   * a dash. They are counted together because they cost the reviewer the same
   * thing — a picture that is not the one the build drew — and separating them
   * would let a frame drawn under the wrong fill report zero.
   */
  readonly skipped: number;
  /** Each distinct reason something was skipped, in the order first met. */
  readonly unreproducible: readonly string[];
}

/** A decoded captured image, in the form the operation naming it expects. */
export type DecodedImage = CanvasImageSource | ImageData;

/**
 * Everything a recording needs decoded before any of its frames can be drawn.
 *
 * Only the images are here. A value the context produced is rebuilt against the
 * context it is drawn into, so it cannot be prepared ahead of a particular canvas
 * and is built inside `drawFrame` instead.
 */
export interface ReplayResources {
  /** `recording.images`, decoded, by index — `null` where decoding failed. */
  readonly images: readonly (DecodedImage | null)[];
}

/**
 * How a captured image is turned into something a context can be handed.
 *
 * The whole decoder is injectable, so the player's drawing can be tested without a
 * real image decoder behind it.
 */
export type ImageDecoder = (image: CapturedImage) => Promise<DecodedImage>;

/**
 * What to say about an image the player has nothing to draw.
 *
 * Phrased as the cause rather than as the mechanism, because a reviewer reads it
 * under the canvas: the recording carried the sprite and this browser would not
 * turn it back into pixels.
 */
const UNDECODED_IMAGE = "an image that could not be decoded";

/**
 * How long one captured image is given to turn back into pixels.
 *
 * A decode that neither resolves nor rejects would otherwise hold the player on
 * "loading" for as long as the tab is open, with nothing on screen and nothing to
 * read: `prepareRecording` waits for every entry, and a browser that drops an
 * image load on the floor reports neither a load nor an error. An expiry is a
 * failed decode, so the replay plays with that one picture missing and named.
 */
const DECODE_TIMEOUT_MS = 10_000;

/** What to say about a reference to a table entry the recording does not hold. */
const MISSING_ENTRY = "a value this replay does not carry";

/**
 * What to say about a recipe that names itself.
 *
 * Unreachable in a recording the engine wrote — a value's recipe is captured from
 * the values that already existed when it was created — and cheap to refuse, which
 * is what keeps a damaged document from recurring until the reviewer's tab dies.
 */
const CIRCULAR_RESOURCE = "a value whose recipe refers to itself";

/** What to say about a frame whose inherited state is not in the recording. */
const MISSING_STATE = "the state this frame inherited";

/**
 * How deep a recorded value may nest before the player refuses to walk it.
 *
 * This is the format's own bound, and it is the same number the recorders encode
 * to: a value nested deeper than this records as `{ $opaque: … }` rather than as
 * itself, so nothing a recorder writes is refused here. What it protects against is
 * a document this player did not write. Twenty thousand nested arrays would
 * otherwise recur until the stack ran out, and the `RangeError` would come out of
 * `drawFrame`, out of the effect that called it, and take the page with it.
 */
const RESOLVE_DEPTH = 32;

/** What to say about a value nested deeper than the format allows. */
const TOO_DEEP = "a value nested deeper than this format carries";

/**
 * What to say about a frame whose recorder ran out of room.
 *
 * Written as the cause, because the reviewer can act on it: the picture is close
 * to the build's and is not it, and what to do about that is to look at a build
 * that saves without restoring or never begins a path, rather than to distrust the
 * player. Named once per frame, however many of the three shadows were cut down.
 */
const TRUNCATED =
  "a save stack, clip or path too deep for this format to carry";

/**
 * Whether `property` may be assigned on `subject` at all.
 *
 * A recorded assignment names whatever the build assigned, and a build is free to
 * assign anything: `ctx.__proto__ = null` is a real statement that a real recorder
 * records as `{ op: "set", property: "__proto__", value: null }`. Performed on the
 * reviewer's context that one destroys it — every canvas method lives on the
 * prototype, so the NEXT frame's blank throws `ctx.setTransform is not a function`
 * out of `drawFrame`, out of the effect that called it, and takes the page with
 * it. The whole player is written so that a document it cannot reproduce costs a
 * report and not a frame, and an assignment is the one place where performing the
 * operation can cost more than the operation.
 *
 * So the name has to be one the subject itself carries and will take. The walk
 * stops **before** `Object.prototype`, which is exactly the line between the two:
 * a canvas property is an accessor on the context's own prototype (or, on some
 * hosts, an own property of the instance), while `__proto__`, `constructor` and
 * `toString` are reached only by falling through to the root object. A name found
 * nowhere below that line is refused as well — assigning it would make an expando
 * nothing draws from, so the operation is a loss either way and the reviewer is
 * better told about it.
 *
 * An accessor with no setter and a non-writable data property are refused for the
 * same reason a missing name is: the assignment cannot land, and in sloppy mode it
 * fails silently rather than throwing into the `try` around it.
 */
function assignable(subject: object, property: string): boolean {
  let host: object | null = subject;
  while (host !== null && host !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(host, property);
    if (descriptor !== undefined) {
      if (descriptor.get !== undefined || descriptor.set !== undefined) {
        return typeof descriptor.set === "function";
      }
      return descriptor.writable === true;
    }
    host = Object.getPrototypeOf(host) as object | null;
  }
  return false;
}

/**
 * The value each context property holds on a freshly reset context — the canvas
 * specification's initial values, for every property the recorder snapshots.
 *
 * A recording carries a frame's WHOLE inherited state, so a property the build
 * never touched still travels, at the value it had: `imageSmoothingQuality: "low"`
 * on every frame of every recording taken on Chromium. A context that has not got
 * the property refuses the name, and refusing it loses nothing — `blank` had
 * already put the context at its defaults, which is exactly where the assignment
 * would have left it. Without this table every such frame was reported as missing
 * a part, on every browser that lacks any one property (Firefox has never carried
 * `imageSmoothingQuality`), which made the report mean nothing. It is consulted
 * only once an assignment has already failed to land, so a property that does take
 * is never compared against it.
 */
const PROPERTY_DEFAULTS: Readonly<Record<string, unknown>> = {
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  filter: "none",
  imageSmoothingEnabled: true,
  imageSmoothingQuality: "low",
  strokeStyle: "#000000",
  fillStyle: "#000000",
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowBlur: 0,
  shadowColor: "rgba(0, 0, 0, 0)",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 10,
  lineDashOffset: 0,
  font: "10px sans-serif",
  textAlign: "start",
  textBaseline: "alphabetic",
  direction: "ltr",
  letterSpacing: "0px",
  wordSpacing: "0px",
  fontKerning: "auto",
  fontStretch: "normal",
  fontVariantCaps: "normal",
  textRendering: "auto",
};

/**
 * Whether an assignment of `value` to `property` that did not land cost the frame
 * anything: it did not if the value is the property's default, because the context
 * was blanked to its defaults before the frame was applied and is already there.
 */
function harmlessWhenRefused(property: string, value: unknown): boolean {
  return (
    Object.prototype.hasOwnProperty.call(PROPERTY_DEFAULTS, property) &&
    PROPERTY_DEFAULTS[property] === value
  );
}

/** A value resolved into something a context can be handed, or why it could not be. */
type Resolution =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/** What is needed to resolve this frame's references, and what has been resolved. */
interface Scope {
  /** The context being drawn into — what a resource's recipe is issued against. */
  readonly ctx: CanvasRenderingContext2D;
  readonly recording: Recording;
  readonly resources: ReplayResources;
  /**
   * Resources built for THIS frame, by index, successes and failures alike.
   *
   * Memoising the failures matters as much as memoising the successes: a recipe
   * this context refuses is refused identically every time it is named, and a
   * frame that fills a hundred shapes with one pattern should try once.
   */
  readonly built: Map<number, Resolution>;
}

/**
 * Turn one captured entry into something a context can be handed.
 *
 * A pixel buffer is rebuilt from the bytes the entry carries, so there is nothing
 * to wait for and nothing that can half-happen: it either is that many bytes or it
 * is not. A bitmap is a PNG, which only the platform can decode, so it is decoded
 * under a bound on how long that may take — everything under the bound can wait on
 * the platform, and nothing above it waits forever.
 */
async function decodeCapturedImage(
  image: CapturedImage,
): Promise<DecodedImage> {
  if (image.kind === "pixels") {
    return rebuildPixels(image.data, image.width, image.height);
  }
  return withTimeout(
    decodeElement(image.src),
    DECODE_TIMEOUT_MS,
    "the image did not decode in time",
  );
}

/**
 * Rebuild a `pixels` entry from the RGBA bytes it carries.
 *
 * `putImageData` writes the bytes it is handed, so the bytes handed back have to be
 * the bytes that were captured. Carrying them raw is what makes that true: a PNG
 * would have to be decoded into a canvas and read out of one, and a canvas stores
 * premultiplied colour, so a partly transparent pixel would be quantised to eight
 * bits on the way in and again on the way out and come back a neighbouring colour.
 * The bytes are copied straight into the buffer instead, with no decoder and no
 * canvas between the recording and the picture.
 *
 * A length that does not match the size the entry declares is a damaged entry
 * rather than a browser that fell short, and it is refused the same way: the
 * operations naming it are skipped and named.
 */
function rebuildPixels(data: string, width: number, height: number): ImageData {
  const bytes = base64Bytes(data);
  if (bytes === null) throw new Error("the pixel buffer is not base64");
  if (bytes.length !== width * height * 4) {
    throw new Error(
      `the pixel buffer holds ${bytes.length} bytes, not the ${width * height * 4} a ${width}×${height} picture needs`,
    );
  }
  if (typeof ImageData !== "function") {
    throw new Error("this environment cannot hold an ImageData");
  }
  return new ImageData(new Uint8ClampedArray(bytes), width, height);
}

/** The bytes behind a base64 string, or `null` when it is not base64. */
function base64Bytes(encoded: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Load a data URL into an image element, or reject.
 *
 * `decode()` is preferred where the platform offers it because it reports a
 * failure as a rejection; the load events are the same answer where it does not.
 */
function decodeElement(src: string): Promise<HTMLImageElement> {
  if (typeof Image === "undefined") {
    return Promise.reject(new Error("this environment has no image decoder"));
  }
  const element = new Image();
  element.src = src;
  if (typeof element.decode === "function") {
    return element.decode().then(() => element);
  }
  return new Promise((resolve, reject) => {
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("the image did not decode"));
  });
}

/** Fail `work` if it has not settled within `ms`, so no caller waits forever. */
function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Decode everything a recording's frames will need, before playback starts.
 *
 * Every entry is decoded, once, whether or not the frame the reviewer lands on
 * draws it — a scrub bar goes anywhere, and decoding on demand would make the
 * first visit to a frame cost more than the ones after it. An entry that will not
 * decode resolves to `null` rather than failing the recording: a replay missing
 * one sprite is worth watching, and the operations that name it are skipped and
 * reported like any other value the player cannot reproduce.
 */
export async function prepareRecording(
  recording: Recording,
  decode: ImageDecoder = decodeCapturedImage,
): Promise<ReplayResources> {
  const images = await Promise.all(
    recording.images.map(async (image) => {
      try {
        return await decode(image);
      } catch {
        return null;
      }
    }),
  );
  return { images };
}

/**
 * Resolve one recorded value into something a context can be handed.
 *
 * Plain data resolves to itself, a `$img` to the decoded image it names, a `$res`
 * to the value its recipe rebuilds, and an `$opaque` to a refusal carrying the type
 * the recorder could not carry. Arrays and objects resolve element by element and
 * fail whole: an argument bag with one unreproducible field in it would make the
 * call mean something different, so the call is skipped rather than issued with a
 * hole in it.
 *
 * `depth` is how many containers this value is already inside, and it bounds the
 * walk at the format's own nesting limit. The check guards the *expansion* of a
 * container rather than the lookup of a marker, so the `{ $opaque: … }` a recorder
 * writes at the bottom of a structure it refused to expand still resolves to a
 * refusal naming the type, which is the more useful of the two sentences.
 */
function resolve(value: DrawValue, scope: Scope, depth: number): Resolution {
  if (value === null || typeof value !== "object") return { ok: true, value };

  if (Array.isArray(value)) {
    if (depth >= RESOLVE_DEPTH) return { ok: false, reason: TOO_DEEP };
    const resolved = resolveAll(
      value as readonly DrawValue[],
      scope,
      depth + 1,
    );
    if (!resolved.ok) return resolved;
    return { ok: true, value: resolved.values };
  }

  const record = value as { readonly [key: string]: DrawValue };
  if ("$opaque" in record) {
    const name = record.$opaque;
    return {
      ok: false,
      reason: typeof name === "string" ? name : "an unrecordable value",
    };
  }
  if ("$img" in record) {
    const index = record.$img;
    if (typeof index !== "number") return { ok: false, reason: MISSING_ENTRY };
    if (index < 0 || index >= scope.resources.images.length) {
      return { ok: false, reason: MISSING_ENTRY };
    }
    const image = scope.resources.images[index];
    if (image === null || image === undefined) {
      return { ok: false, reason: UNDECODED_IMAGE };
    }
    return { ok: true, value: image };
  }
  // Everything from here expands: a recipe is issued and its own arguments are
  // resolved, a plain object is walked field by field. `$opaque` and `$img` above
  // are lookups, which is why the bound sits between them — the marker a recorder
  // writes at the bottom of a structure it refused to expand is itself an object at
  // the bound, and it resolves to a refusal naming the type rather than to this one.
  if (depth >= RESOLVE_DEPTH) return { ok: false, reason: TOO_DEEP };

  if ("$res" in record) {
    const index = record.$res;
    if (typeof index !== "number") return { ok: false, reason: MISSING_ENTRY };
    // A recipe's own arguments may name further resources, so the chain counts
    // against the same bound as nested data does: without that, a document whose
    // recipes name each other twenty thousand deep is the `RangeError` this bound
    // exists to prevent, arriving by another route. The memo that refuses a recipe
    // naming ITSELF does nothing about a chain that never comes back round.
    return build(index, scope, depth + 1);
  }

  // Built without a prototype, because a recorded object may carry a "__proto__"
  // key: assigned onto an ordinary object that key reaches the prototype setter
  // instead of becoming a field, and the call would be issued with the field
  // missing rather than with the value the build passed.
  const resolved = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    const field = resolve(entry, scope, depth + 1);
    if (!field.ok) return field;
    resolved[key] = field.value;
  }
  return { ok: true, value: resolved };
}

/** Resolve a list of values, failing whole on the first one that cannot be. */
function resolveAll(
  values: readonly DrawValue[],
  scope: Scope,
  depth: number,
):
  | { readonly ok: true; readonly values: unknown[] }
  | { readonly ok: false; readonly reason: string } {
  const resolved: unknown[] = [];
  for (const value of values) {
    const entry = resolve(value, scope, depth);
    if (!entry.ok) return entry;
    resolved.push(entry.value);
  }
  return { ok: true, values: resolved };
}

/**
 * Build the resource at `index` against the context this frame is being drawn
 * into, or say why it could not be.
 *
 * The index is marked as in progress before the recipe's own arguments are
 * resolved, so a recipe that names itself is refused instead of recurring.
 */
function build(index: number, scope: Scope, depth: number): Resolution {
  const memo = scope.built.get(index);
  if (memo !== undefined) return memo;
  const recipe = scope.recording.resources[index];
  if (recipe === undefined) return { ok: false, reason: MISSING_ENTRY };
  scope.built.set(index, { ok: false, reason: CIRCULAR_RESOURCE });
  const outcome = make(recipe, scope, depth);
  scope.built.set(index, outcome);
  return outcome;
}

/**
 * Issue a recipe's creating call, then apply the mutations it carries, in order.
 *
 * The call is whatever the recipe names, because `parseRecording` has already
 * refused every document naming anything but the four producing methods. That
 * check belongs there rather than here: a recipe re-issued against the context
 * being drawn into is faithful only for a call whose answer is independent of that
 * context, and one that is not — a `getTransform()` — would have the player paint
 * the whole frame under an answer of its own and report nothing.
 */
function make(recipe: Resource, scope: Scope, depth: number): Resolution {
  const args = resolveAll(recipe.make.args, scope, depth);
  if (!args.ok) return args;
  const host = scope.ctx as unknown as Record<string, unknown>;
  const method = host[recipe.make.method];
  if (typeof method !== "function") {
    return { ok: false, reason: `${recipe.make.method}()` };
  }
  let value: unknown;
  try {
    value = (method as (...rest: unknown[]) => unknown).apply(
      scope.ctx,
      args.values,
    );
  } catch {
    return { ok: false, reason: `${recipe.make.method}()` };
  }
  if (value === null || value === undefined) {
    // A producing call answers nothing when it cannot make the value — a
    // `createPattern` handed a source this context will not take. Assigning that
    // answer is worse than skipping it: a canvas ignores `fillStyle = null`
    // outright, so the frame would fill under whatever colour it inherited and
    // report itself clean.
    return { ok: false, reason: `${recipe.make.method}()` };
  }
  for (const step of recipe.then) {
    // A mutation that does not land is not a cosmetic loss: a gradient missing a
    // colour stop paints a different picture. The whole resource fails, and every
    // operation drawing with it is reported.
    const reason = perform(value, step, scope, depth);
    if (reason !== null) return { ok: false, reason };
  }
  return { ok: true, value };
}

/**
 * How deep the player left each context's save stack, so the next frame can empty
 * it.
 *
 * Drawing a frame pushes a level per entry of its save stack and the frame's own
 * operations push and pop more, so a frame ends at whatever depth its build was at.
 * A context that offers `reset` empties itself; one that does not has to be emptied
 * by hand, and the only way to know how many levels are outstanding is to have
 * counted them — a canvas reports neither its depth nor its clip.
 *
 * The count is an upper bound rather than an exact depth: an operation that emptied
 * the stack by other means leaves it too high. That is the safe direction, because
 * a `restore` on an empty stack is a no-op while a level left standing carries the
 * frame before it into this one.
 */
const outstandingSaves = new WeakMap<CanvasRenderingContext2D, number>();

/**
 * Wipe the context back to a blank page before the frame is applied to it.
 *
 * `reset` is used where the context offers it, because it restores *every* piece
 * of state to its default and empties the save stack — so neither a property the
 * frame's inherited state happens not to mention nor a level the frame before it
 * pushed can leak in from whatever was drawn here before. Where it is absent (an
 * older engine, and the hand-written contexts the tests drive) the save stack is
 * unwound by hand first, then the transform is cleared and the surface wiped: the
 * frame's own state and operations overwrite the rest, but a level left on the
 * stack is not state the frame overwrites — the frame's own `restore` would pop to
 * whatever the frame before it had saved, and every operation after that would draw
 * under it.
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
  const outstanding = outstandingSaves.get(ctx) ?? 0;
  outstandingSaves.delete(ctx);
  const resettable = ctx as CanvasRenderingContext2D & { reset?: () => void };
  if (typeof resettable.reset === "function") resettable.reset();
  else for (let i = 0; i < outstanding; i += 1) ctx.restore();
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
 * Apply the context state a frame inherited: the properties, then the clip
 * segments, then `beginPath`, then the path segments, then the transform, then the
 * dash pattern.
 *
 * The order is the format's, and every step of it is load-bearing.
 *
 * The clip and the path are applied to the context rather than read back from one,
 * so they have to be re-issued here or the frame draws outside the region the build
 * was confined to, or over a path the build had already opened. Both are given in
 * user space, so each segment establishes the transform its own operations were
 * issued under. `setTransform` replaces the transform outright, which is why the
 * state's own comes after the segments that disturbed it rather than before them.
 *
 * The `beginPath` between the two is what keeps an inherited clip from becoming an
 * inherited path. Re-issuing a clip segment means re-issuing the path that made it,
 * which leaves that outline current, and a frame whose first operation is a bare
 * `fill()` would then fill the clip outline instead of the shape the build drew —
 * a 30×30 rectangle replaying as a fill of the whole surface, reported as clean.
 * The original context was in the same position and the build called `beginPath`
 * itself; this is that call.
 *
 * A property whose value cannot be resolved is left at its default instead of
 * being assigned a guess, and is counted — a frame drawn under the wrong fill is a
 * frame that lies quietly, which is the one outcome worth refusing.
 */
function applyState(
  state: DrawState,
  scope: Scope,
  skip: (reason: string) => void,
): void {
  const properties = scope.ctx as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(state.properties)) {
    // Before the value is resolved, because a name this context will not take
    // costs the property whatever the value turns out to be, and resolving one
    // means building whatever resources it names against this context for nothing.
    // A state block reaches the context by the same assignment a `set` operation
    // does and is guarded by the same rule; see `assignable`.
    // An assignment that cannot land is reported only if it would have changed
    // something; a default value refused by a context without the property is
    // the state the context is already in. See `PROPERTY_DEFAULTS`.
    if (!assignable(scope.ctx, name)) {
      if (!harmlessWhenRefused(name, value)) skip(`the ${name} property`);
      continue;
    }
    const resolved = resolve(value, scope, 0);
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
      if (!harmlessWhenRefused(name, resolved.value))
        skip(`the ${name} property`);
    }
  }

  for (const segment of state.clip) applySegment(segment, scope, skip);

  // Unconditional, because it is what separates the clip's outline from the path
  // the frame inherited — a state with no path of its own inherits an EMPTY path,
  // and leaving the clip outline current instead is the difference between a
  // 30×30 fill and a full-surface one.
  try {
    scope.ctx.beginPath();
  } catch {
    skip("beginPath()");
  }

  for (const segment of state.path) applySegment(segment, scope, skip);

  if (state.transform !== null && !applyTransform(scope.ctx, state.transform)) {
    skip("setTransform()");
  }
  if (state.lineDash !== null) {
    // Guarded for the same reason the property assignments above are: the set of
    // calls a context carries differs between a browser and the native canvas a
    // validator draws on, and a dash this one will not take must cost the dash and
    // be reported rather than cost the rest of the state.
    try {
      scope.ctx.setLineDash([...state.lineDash]);
    } catch {
      skip("setLineDash()");
    }
  }
}

/**
 * Re-apply one segment of a clip region or of a current path: put the transform its
 * operations were issued under in force, then issue them.
 *
 * Clips intersect rather than replace, so the segments of a state are applied in
 * the order they were applied originally and the region in force at the end is the
 * region the build drew under. A path is built up the same way, one run of
 * operations per transform. A segment this context refuses is reported like any
 * other operation — a frame drawn without one of its clips shows pixels the build
 * did not, and one drawn without part of its path shows a different shape.
 */
function applySegment(
  segment: PathSegment,
  scope: Scope,
  skip: (reason: string) => void,
): void {
  if (
    segment.transform !== null &&
    !applyTransform(scope.ctx, segment.transform)
  ) {
    skip("setTransform()");
  }
  for (const op of segment.ops) {
    const reason = perform(scope.ctx, op, scope, 0);
    if (reason !== null) skip(reason);
  }
}

/**
 * Put a recorded transform in force, answering whether it landed.
 *
 * `parseRecording` accepts a transform only as six numbers, so the shape is never
 * in question here: a shorter one could only be dropped, and dropping it draws the
 * rest of the frame under whatever transform preceded it and reports nothing. What
 * is in question is the context — a hand-written one that does not carry
 * `setTransform` at all — so the caller is told and reports it rather than drawing
 * the segment that follows in the wrong place, silently.
 */
function applyTransform(
  ctx: CanvasRenderingContext2D,
  transform: readonly number[],
): boolean {
  const [a, b, c, d, e, f] = transform as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  try {
    ctx.setTransform(a, b, c, d, e, f);
  } catch {
    return false;
  }
  return true;
}

/**
 * Perform one operation against `subject`, returning `null` or the reason it was
 * not performed.
 *
 * The subject is the context for one of the recording's own operations and the
 * rebuilt value for a step of a resource's recipe. The two are the same act — set
 * a property, or call a method with resolved arguments — so they are the same code,
 * and a recipe's steps report their failures in the same words a frame's operations
 * do.
 *
 * `depth` is how deep in a chain of recipes this operation is being performed, and
 * it travels into the values it resolves so that the nesting bound covers a chain
 * of recipes as well as a nest of arrays. A frame's own operations are at the top,
 * so they perform at depth zero.
 */
function perform(
  subject: unknown,
  op: DrawOp,
  scope: Scope,
  depth: number,
): string | null {
  const named =
    op.op === "set" ? `the ${op.property} property` : `${op.method}()`;
  if (subject === null || subject === undefined) return named;
  const host = subject as Record<string, unknown>;

  if (op.op === "set") {
    // The name is checked before the value is resolved: an assignment that cannot
    // land costs the property whatever value it carried, and a name the subject
    // does not carry as a writable property of its own is refused outright rather
    // than performed. Performing it is what a context does not survive — see
    // `assignable`.
    // A refusal of a value the property already holds by default costs nothing
    // and is not reported; see `PROPERTY_DEFAULTS`.
    if (!assignable(host, op.property)) {
      return harmlessWhenRefused(op.property, op.value) ? null : named;
    }
    const value = resolve(op.value, scope, depth);
    if (!value.ok) return value.reason;
    try {
      host[op.property] = value.value;
    } catch {
      return harmlessWhenRefused(op.property, value.value) ? null : named;
    }
    return null;
  }

  // The arguments are resolved before the method is looked up, so a call carrying a
  // value the recorder could not carry is reported by that value's own name rather
  // than by whichever context happens to be drawing it — the cause is in the
  // recording either way, and the recorder's label is the one that says what is
  // missing from the picture.
  const args = resolveAll(op.args, scope, depth);
  if (!args.ok) return args.reason;
  const method = host[op.method];
  if (typeof method !== "function") return named;
  try {
    (method as (...rest: unknown[]) => unknown).apply(subject, args.values);
  } catch {
    // One operation a context rejects — an image drawn from a source it will not
    // take, a font it cannot parse — must not cost the reviewer the rest of the
    // frame. It is reported the same way an unreproducible value is.
    return named;
  }
  return null;
}

/**
 * Draw one frame of a recording onto a context.
 *
 * `frame` is an index into `recording.frames`; an index outside it draws nothing
 * and reports nothing, which is how a pane holds its last frame while the pane
 * beside it plays on.
 *
 * `resources` is what `prepareRecording` returned for this recording. Passing one
 * prepared from another recording resolves images to the wrong pictures, so the
 * two travel together everywhere the player carries them.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  recording: Recording,
  resources: ReplayResources,
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

  // Built fresh for this frame, because a resource is bound to the context it was
  // created against and there is no promise the next frame is drawn into the same
  // one. See the note at the top of the file.
  const scope: Scope = { ctx, recording, resources, built: new Map() };

  blank(ctx, recording, shot);

  // Reported before anything is applied, so it heads the list of what this frame
  // could not carry. The recorder bounds each of the three shadows it keeps — the
  // save stack, the clip region, the current path — and a frame that hit a bound
  // inherits a state that is close to the one the build had rather than equal to
  // it. Everything below then draws that state faithfully and would report
  // nothing, which is a picture the format could not carry told as one it could.
  if (shot.truncated === true) skip(TRUNCATED);

  // The states the context had saved when the frame opened, outermost first. Each
  // is applied and then pushed, so a `restore()` among the frame's own operations
  // pops to the state the build popped to rather than to a blank context. A state
  // the recording does not carry is still pushed: the depth is what a restore
  // counts, and losing a level would put every operation after it under the wrong
  // state.
  //
  // How deep the stack is left is counted as it goes, so the next frame drawn into
  // this context can unwind it where the context has no `reset` of its own.
  let depth = 0;
  for (const index of shot.stack) {
    const stacked = recording.states[index];
    if (stacked === undefined) skip(MISSING_STATE);
    else applyState(stacked, scope, skip);
    ctx.save();
    depth += 1;
  }

  const state = recording.states[shot.state];
  if (state === undefined) skip(MISSING_STATE);
  else applyState(state, scope, skip);

  let drawn = 0;
  for (const index of shot.ops) {
    const op = recording.ops[index];
    if (op === undefined) {
      skip(MISSING_ENTRY);
      continue;
    }
    const reason = perform(ctx, op, scope, 0);
    if (reason !== null) {
      skip(reason);
      continue;
    }
    drawn += 1;
    // A frame's own `save` and `restore` move the stack the same way the entries
    // above did, and only the ones that actually reached the context count. A
    // `restore` at depth zero is a no-op on a canvas, so the floor is the context's
    // behaviour rather than a guard over it.
    if (op.op === "call") {
      if (op.method === "save") depth += 1;
      else if (op.method === "restore") depth = Math.max(0, depth - 1);
    }
  }
  outstandingSaves.set(ctx, depth);

  return { drawn, skipped, unreproducible };
}
