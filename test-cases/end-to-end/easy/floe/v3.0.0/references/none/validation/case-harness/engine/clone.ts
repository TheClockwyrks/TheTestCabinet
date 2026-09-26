// `structuredClone` as a browser gives it to a build holding decoded images.
//
// WHY THIS EXISTS. A browser `ImageBitmap` is serializable: a build that keeps
// its sprites in its state — which is what every engine's `assets.md` has it
// do — and builds its next state with `structuredClone` gets a working bitmap
// back on the far side. The canvas library's `Image`, which `./assets` hands
// back from `createImageBitmap`, is not: Node's serializer has no encoding for
// a native handle, and the library leaves `onload` and `onerror` as own
// function properties on a decoded image, which the serializer refuses
// outright with `DataCloneError`. Every pose such a build takes clones its
// state, so the first one throws and the run loses EVERY point for a fact
// about the stand-in.
//
// HOW. The value is walked once before the platform's clone and once after. On
// the way in, every instance the caller wants kept is swapped for a placeholder
// the serializer can carry; on the way out, each placeholder is swapped back
// for the instance it stood for. The walk rebuilds only what can HOLD an
// instance — a plain object, an array, a `Map`, a `Set` — and hands every other
// object to the platform whole, so a `Date`, a `Blob`, a typed array, a cycle
// and a shared reference come back exactly as the platform gives them, and a
// value the platform refuses — a function, a `WeakMap`, a `Promise`, a `URL` —
// is refused here too, by the platform, with its own error. What the platform
// drops, the walk drops: a symbol-keyed property, a non-enumerable one, and the
// prototype of a class instance, which comes back as a plain object either way.
// A value with no instance anywhere inside it is not rebuilt at all; the
// platform clones the original.
//
// WHAT THE WALK CANNOT TELL APART. A `Proxy` over a plain object answers every
// question a plain object answers, so it is walked as one where the platform
// would refuse it; and a class whose prototype names a `Symbol.toStringTag`
// reads as the type it names and is handed to the platform whole, which refuses
// an instance inside it.
//
// BY REFERENCE, NOT BY COPY. A decoded bitmap is immutable, so identity is the
// only thing a copy could differ in — and sharing is what keeps an
// identity-keyed reading (`sourceOf`, the recorder's interning of drawn images)
// answering for the copy exactly what it answers for the original.

/** A `structuredClone` with the platform's signature. */
export type StructuredClone = <T>(
  value: T,
  options?: StructuredSerializeOptions,
) => T;

/** A placeholder's one key, which nothing a build serializes is named. */
const PLACEHOLDER = " case-harness:kept";

/** What stands in for a kept instance while the platform's clone runs. */
interface Placeholder {
  readonly [PLACEHOLDER]: number;
}

/** Whether a value is a placeholder this module put down. */
function isPlaceholder(value: unknown): value is Placeholder {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    typeof (value as Record<string, unknown>)[PLACEHOLDER] === "number"
  );
}

/**
 * Whether the platform's clone copies a value AS an object whose own enumerable
 * properties it walks — a plain object, a null-prototype object, or a class
 * instance, which comes back as a plain object — rather than as one of the
 * types it encodes whole or refuses.
 *
 * Decided by the class the object reports, which is what every platform type
 * carries and a plain object does not: a `Blob`, a `Date`, a `DataView`, an
 * `Error`, a boxed primitive all name themselves, and so do the types the
 * platform refuses — a `WeakMap`, a `Promise` — which must reach it to be
 * refused rather than be flattened into a bag of nothing. An array, a `Map` and
 * a `Set` can hold an instance and are walked on their own, before this is
 * asked.
 */
function walkable(value: object): boolean {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * A `structuredClone` that carries every instance `kept` admits across by
 * reference, and clones everything else with `through`.
 *
 * `through` is the platform's own clone, handed in by the caller rather than
 * read off `globalThis` here, so a caller installing this OVER
 * `globalThis.structuredClone` passes the one it found.
 */
export function cloneKeeping(
  kept: (value: object) => boolean,
  through: StructuredClone,
): StructuredClone {
  return <T>(value: T, options?: StructuredSerializeOptions): T => {
    if (typeof value !== "object" || value === null) {
      return through(value, options);
    }

    const instances: object[] = [];
    const put = new Map<object, unknown>();

    /** The value with every kept instance swapped for a placeholder. */
    const swapOut = (v: unknown): unknown => {
      if (typeof v !== "object" || v === null) return v;
      const known = put.get(v);
      if (known !== undefined) return known;
      if (kept(v)) {
        const placeholder: Placeholder = { [PLACEHOLDER]: instances.length };
        instances.push(v);
        put.set(v, placeholder);
        return placeholder;
      }
      if (Array.isArray(v)) {
        // Rebuilt key by key rather than item by item, because the platform
        // carries an array's holes and its named properties, and a walk over
        // its indices would fill the one and drop the other.
        const out = new Array<unknown>(v.length) as unknown[] &
          Record<string, unknown>;
        put.set(v, out);
        for (const k of Object.keys(v)) {
          out[k] = swapOut((v as unknown as Record<string, unknown>)[k]);
        }
        return out;
      }
      if (v instanceof Map) {
        const out = new Map<unknown, unknown>();
        put.set(v, out);
        for (const [k, item] of v) out.set(swapOut(k), swapOut(item));
        return out;
      }
      if (v instanceof Set) {
        const out = new Set<unknown>();
        put.set(v, out);
        for (const item of v) out.add(swapOut(item));
        return out;
      }
      if (!walkable(v)) return v;
      const out: Record<string, unknown> = {};
      put.set(v, out);
      for (const [k, item] of Object.entries(v)) out[k] = swapOut(item);
      return out;
    };

    const seen = new Set<object>();

    /** The clone with every placeholder swapped back, in place. */
    const swapIn = (v: unknown): unknown => {
      if (typeof v !== "object" || v === null) return v;
      if (isPlaceholder(v)) return instances[v[PLACEHOLDER]];
      if (seen.has(v)) return v;
      seen.add(v);
      if (Array.isArray(v)) {
        // Over the keys the clone carries, so a hole stays a hole and a named
        // property is swapped like an index.
        const bag = v as unknown as Record<string, unknown>;
        for (const k of Object.keys(v)) bag[k] = swapIn(bag[k]);
        return v;
      }
      if (v instanceof Map) {
        const entries = [...v];
        v.clear();
        for (const [k, item] of entries) v.set(swapIn(k), swapIn(item));
        return v;
      }
      if (v instanceof Set) {
        const items = [...v];
        v.clear();
        for (const item of items) v.add(swapIn(item));
        return v;
      }
      if (Object.getPrototypeOf(v) !== Object.prototype) return v;
      const bag = v as Record<string, unknown>;
      for (const k of Object.keys(bag)) bag[k] = swapIn(bag[k]);
      return v;
    };

    const swapped = swapOut(value);
    // Nothing kept means nothing to put back, and the platform's clone of the
    // ORIGINAL keeps whatever a class instance's own clone would have kept.
    if (instances.length === 0) return through(value, options);
    return swapIn(through(swapped, options)) as T;
  };
}
