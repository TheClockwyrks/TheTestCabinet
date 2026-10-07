// Re-expressing a recording against tables of only what it still names, and
// cutting it down to the frames a player will actually show.

import type { RecordedOp } from "../draw-calls";
import {
  MAX_REPLAY_FRAMES,
  type RecordedFrame,
  type RecordedPathSegment,
  type RecordedResource,
  type RecordedState,
  type Recording,
} from "./format";
import type { ImageStore } from "./store";

/**
 * An entry of a table the recording carries, by the index something names it at.
 *
 * Every index here was written by the injected recorder against the same
 * document, so a miss means the recording itself is inconsistent. Saying so is
 * better than rewriting `undefined` into the file: the writer runs this inside
 * the `try` it already swallows, so a malformed recording is reported as an
 * output that could not be written, exactly as any other failure of the write is.
 *
 * The images table is the one exception and deliberately: see `takeImage` below,
 * which answers `null` for an entry it cannot carry so that the shared store has
 * somewhere to refuse to.
 */
function at<T>(table: readonly T[], index: number, what: string): T {
  const found = table[index];
  if (found === undefined) {
    throw new Error(
      `the recording names ${what} ${index}, which it does not carry`,
    );
  }
  return found;
}

/**
 * A value's JSON with object keys in a fixed order, as the key a table
 * deduplicates on.
 *
 * Two operations that mean the same thing have to serialize identically for a
 * table to hold one copy of each, and the key order inside an argument the build
 * passed is the build's own business rather than ours.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** Add `entry` to a table if it is new, and answer where it lives. */
export function intern<T>(
  table: T[],
  seen: Map<string, number>,
  entry: T,
): number {
  const key = canonical(entry);
  const found = seen.get(key);
  if (found !== undefined) return found;
  const index = table.length;
  table.push(entry);
  seen.set(key, index);
  return index;
}

/**
 * `frames` re-expressed against tables holding only what those frames name.
 *
 * DROPPING A FRAME DROPS THE LAST REFERENCE TO WHATEVER ONLY THAT FRAME DREW
 * WITH. Tables carried over whole would put operations, gradients and images in
 * the file that no frame asks for — dead weight in a document whose whole point
 * is to say each thing once, and the bulk of it in a game that draws procedurally
 * and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively: a frame names its own state and
 * the states saved under it, whose clip and path segments and inherited fill name
 * operations and resources, whose own creating calls may name images. What is
 * deduplicated is the rewritten entry, so an operation two hundred frames issue
 * identically is written once and named two hundred times, and every index a
 * frame carries addresses the table it was interned into.
 *
 * A `store`, when there is one, is where each distinct image's BYTES go: the
 * table then carries a reference to a file beside the recording rather than a
 * base64 payload inside it, so an image forty recordings draw is written once for
 * the run and travels as PNG rather than as base64 inside a gzip that cannot
 * compress it. Omitting it — or passing `null`, which is what `openImageStore`
 * answers outside a run — writes every entry inline, which is the shape a
 * recording has always had and still a first-class member of the format.
 *
 * Exported for the package's own suite, which drives it over a recording a
 * browser cannot deliver: Playwright's serializer drops an own field named
 * `__proto__` on the way out of the page, so handing one to this directly is the
 * only way to check that the rewrite carries it.
 */
export function retable(
  recording: Recording,
  frames: RecordedFrame[],
  store?: ImageStore | null,
): Recording {
  const images: unknown[] = [];
  const imageAt = new Map<string, number>();
  const resources: RecordedResource[] = [];
  const resourceAt = new Map<number, number>();
  const ops: RecordedOp[] = [];
  const opAt = new Map<string, number>();
  const states: RecordedState[] = [];
  const stateAt = new Map<string, number>();

  /**
   * What an image entry is deduplicated on, and NOT through {@link canonical}.
   *
   * An entry's payload is the whole of its weight — a PNG data URL or a base64
   * pixel buffer, either of them megabytes — so a JSON re-encoding to answer
   * "have I seen this" would copy those megabytes once per lookup. This is the
   * same key the page-side pool shares an image on, for the same reason.
   *
   * An entry that carries no payload of a shape this recognises falls back to the
   * canonical form. That is the small case by construction — a stored entry names
   * a file rather than carrying one — so the copy is a file name.
   */
  const imageKeyOf = (entry: unknown): string => {
    if (entry === null || typeof entry !== "object") return canonical(entry);
    const record = entry as Record<string, unknown>;
    const payload = record.kind === "pixels" ? record.data : record.src;
    if (typeof payload !== "string") return canonical(entry);
    return `${String(record.kind)}|${String(record.width)}x${String(record.height)}|${payload}`;
  };

  /**
   * Where the entry `source` names lives in the rebuilt table, or `null` when the
   * recording does not carry it and nothing can be written for it.
   *
   * CONTENT-KEYED, like the `ops` and `states` beside it and unlike the source
   * index this used to hold: a build that redraws the same sprite through a fresh
   * capture each frame names a different index every time for the same picture,
   * and keying on the index writes that picture once per frame.
   *
   * IT ANSWERS `null` RATHER THAN RAISING through {@link at}, which is the one
   * place this file departs from its neighbours. An index the recording does not
   * carry degrades to the opaque marker the player already reports and skips, so
   * a reviewer loses one draw and is told about it, rather than losing the whole
   * replay to an output that could not be written. A store that REFUSES is a
   * different thing and not this one: the entry stays inline, which costs the run
   * bytes and never a picture.
   */
  const takeImage = (source: number): number | null => {
    const raw = recording.images[source];
    if (raw === undefined) return null;
    const key = imageKeyOf(raw);
    const found = imageAt.get(key);
    if (found !== undefined) return found;
    // A store that refused — an undecodable payload, a run past its ceiling, a
    // write the host would not take — hands back `null`, and the entry stays
    // exactly as it was recorded.
    const written = store ? store.put(raw) : null;
    const index = images.length;
    images.push(written ?? raw);
    imageAt.set(key, index);
    return index;
  };

  const takeResource = (source: number): number => {
    const found = resourceAt.get(source);
    if (found !== undefined) return found;
    const recipe = at(recording.resources, source, "a resource");
    // A recipe's own arguments can only name values made before it, so rewriting
    // it terminates and cannot re-enter this resource.
    const rebuilt: RecordedResource = {
      make: { method: recipe.make.method, args: recipe.make.args.map(value) },
      then: recipe.then.map(operation),
    };
    const index = resources.length;
    resources.push(rebuilt);
    resourceAt.set(source, index);
    return index;
  };

  const value = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(value);
    if (entry === null || typeof entry !== "object") return entry;
    const record = entry as Record<string, unknown>;
    if (typeof record.$img === "number") {
      const at = takeImage(record.$img);
      return at === null
        ? { $opaque: "an image this replay could not carry" }
        : { $img: at };
    }
    if (typeof record.$res === "number")
      return { $res: takeResource(record.$res) };
    const rewritten: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(record)) {
      // Defined rather than assigned: a build's own object may carry a field named
      // `__proto__`, and assigning that name reaches the prototype setter instead
      // of writing a field the document carries.
      Object.defineProperty(rewritten, key, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return rewritten;
  };

  const operation = (op: RecordedOp): RecordedOp =>
    op.op === "call"
      ? { op: "call", method: op.method, args: op.args.map(value) }
      : { op: "set", property: op.property, value: value(op.value) };

  const segments = (list: RecordedPathSegment[]): RecordedPathSegment[] =>
    list.map((segment) => ({
      transform: segment.transform,
      ops: segment.ops.map(operation),
    }));

  const stateOf = (state: RecordedState): RecordedState => {
    const properties: Record<string, unknown> = {};
    for (const [name, held] of Object.entries(state.properties)) {
      Object.defineProperty(properties, name, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return {
      properties,
      transform: state.transform,
      lineDash: state.lineDash,
      clip: segments(state.clip),
      path: segments(state.path),
    };
  };

  const takeState = (source: number): number =>
    intern(states, stateAt, stateOf(at(recording.states, source, "a state")));

  return {
    ...recording,
    images,
    resources,
    ops,
    states,
    frames: frames.map((frame) => ({
      ...frame,
      state: takeState(frame.state),
      stack: frame.stack.map(takeState),
      ops: frame.ops.map((op) =>
        intern(ops, opAt, operation(at(recording.ops, op, "an operation"))),
      ),
    })),
  };
}

/**
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole of
 * what was captured, with each kept frame's `deltaMs` restated as the time since
 * the frame kept before it.
 *
 * The restatement is what makes a decimated recording play at the speed the game
 * really ran at: the deltas still sum to the section's elapsed time. The frame
 * `count` is left as it was recorded, so a reader can see that frames were
 * skipped rather than being told a smooth lie. The last frame is always kept
 * whatever the stride lands on — it is the frame the check's sweep stopped at,
 * and the one a reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a
 * section whose length is an exact multiple of the cap strides over exactly that
 * many frames and stops one stride short of the end: the last frame still has to
 * come in, and the cap is a ceiling rather than a target. It takes the place of
 * the final strided frame — the frame nearest it, so the swap opens the smallest
 * gap available anywhere in the section — and is measured from where that frame
 * was measured from, which is what keeps the kept deltas summing to the elapsed
 * time.
 *
 * What survives is then re-expressed against tables of its own, so the file
 * carries what the kept frames draw with and nothing the dropped ones did — and,
 * when a `store` is given, with the images it draws written beside it rather than
 * inside it. See {@link retable}.
 */
export function thinReplay(
  recording: Recording,
  store?: ImageStore | null,
): Recording {
  const { frames } = recording;
  const first = frames[0];
  if (first === undefined) return recording;

  const stride = Math.max(1, Math.ceil(frames.length / MAX_REPLAY_FRAMES));
  const kept: RecordedFrame[] = [];
  let previousMs = first.timeMs - first.deltaMs;
  const keep = (frame: RecordedFrame): void => {
    kept.push({ ...frame, deltaMs: frame.timeMs - previousMs });
    previousMs = frame.timeMs;
  };

  for (let i = 0; i < frames.length; i += stride) {
    keep(at(frames, i, "a frame"));
  }
  const last = at(frames, frames.length - 1, "a frame");
  if (at(kept, kept.length - 1, "a kept frame").count !== last.count) {
    if (kept.length >= MAX_REPLAY_FRAMES) {
      // The stride spent the whole budget on the way to a frame short of the end.
      // Drop the frame it stopped on, and put the moment back to the one before
      // it: a kept frame's restated delta is measured from exactly that moment, so
      // subtracting it recovers it, and the last frame's own delta then spans the
      // gap the two of them leave.
      const displaced = at(kept, kept.length - 1, "a kept frame");
      kept.length -= 1;
      previousMs = displaced.timeMs - displaced.deltaMs;
    }
    keep(last);
  }

  return retable(recording, kept, store);
}
