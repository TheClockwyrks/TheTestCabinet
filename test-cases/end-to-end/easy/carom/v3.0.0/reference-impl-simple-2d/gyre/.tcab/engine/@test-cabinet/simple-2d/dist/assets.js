/**
 * Asset loading: a game names a path, the engine decides the URL.
 *
 * Every path resolves under one fixed root (`assets/` by default). That is a
 * deliberate loss of freedom for the game — it cannot reach a CDN, a data URI or
 * a sibling directory — and it buys two things. A build's asset requests all land
 * somewhere a run's produced tree can be inspected, and one option relocates
 * every request at once, so the same game loads from a served page, from a build
 * output, or from a test process without editing a line of it.
 *
 * The rule is enforced rather than assumed: a path with a leading slash, a `..`
 * segment, or a scheme is refused outright. Anything else would let a game
 * silently opt out of the root, and an escape hatch that only *some* builds use
 * makes the evidence unreadable.
 *
 * Two further shapes are worth stating outright, because both are departures from
 * what a loader usually looks like:
 *
 * - **The loader keeps no record.** Every attempt is announced as an engine event
 *   at the moment it settles, and the loader forgets it. An observer subscribes
 *   before initialization — it can, because the engine exists before any game code
 *   runs — and keeps exactly what it needs. Nothing here grows with the number of
 *   loads, so a long run's memory stays flat.
 * - **A failure is both announced and thrown.** The event is what an observer
 *   reads; the rejection is what the *game* needs, because a build that swallowed
 *   it would render nothing with no explanation. A game that treats a missing file
 *   as fatal lets the rejection escape its `initialize`, and a game with a
 *   fallback catches it — the decision is made once, not on every frame.
 *
 * Decoding lives here rather than in the game: `loadImage` and `loadAudio` hand
 * back the `ImageBitmap` the canvas draws and the `AudioBuffer` a cue plays, so a
 * game uses the result on the next line. `load` is the generic beneath them, for
 * the third kind of file — level data, an atlas description — that keeps the root
 * rule and the events without the engine having to know what the bytes mean.
 */
/** The directory every asset path is resolved under when none is given. */
const DEFAULT_ROOT = "assets/";
/**
 * Matches a leading URI scheme (`http:`, `data:`, `blob:`). Such a path names a
 * location outside the root as surely as a `..` segment does, so it is refused on
 * the same grounds.
 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** The platform's `fetch`, wrapped so it is not called with a detached receiver. */
function defaultFetch(url) {
    return globalThis.fetch(url);
}
/**
 * The browser's audio context, or `null` where there isn't one.
 *
 * Decoding does not need a running context — a suspended one decodes fine — so
 * this is safe to build before any user gesture has unlocked audio, which matters
 * because a game loads its sounds during initialization and no gesture has
 * necessarily happened yet.
 */
function defaultAudioContext() {
    const ctor = globalThis
        .AudioContext;
    return ctor ? new ctor() : null;
}
/** The message an event's `reason` carries for a thrown value of any shape. */
function reasonOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Resolves and loads a game's assets under a fixed root, announcing every attempt.
 *
 * Every collaborator is injected: the fetcher so the loader can be driven without
 * a server (and so a failure a real network cannot be asked for on demand can be
 * produced at will), the root so the engine rather than this class owns the
 * convention, the emitter so this module stays a leaf, and the audio context so a
 * host with no Web Audio degrades to a named rejection instead of throwing on a
 * missing global.
 */
export class AssetLoader {
    root;
    fetcher;
    emit;
    audioContextFactory;
    /**
     * The one thing the loader remembers, and it is a single slot rather than a
     * collection: decoding a hundred sounds must not build a hundred contexts.
     * Still `null` means the factory has not yielded one *yet* — a host whose
     * context appears later gets asked again.
     */
    audioContext = null;
    constructor(options = {}) {
        const root = options.root ?? DEFAULT_ROOT;
        // Normalising the trailing slash here means the root can be written either
        // way at the call site and `resolve` stays a plain concatenation. An empty
        // root is left empty: it means "beside the page", and appending a slash would
        // silently turn every path absolute.
        this.root = root === "" || root.endsWith("/") ? root : `${root}/`;
        this.fetcher = options.fetch ?? defaultFetch;
        this.emit = options.emit ?? (() => { });
        this.audioContextFactory = options.audioContext ?? defaultAudioContext;
    }
    /**
     * Turns a game-supplied path into the URL it loads from, throwing if the path
     * would escape the asset root.
     *
     * Pure: it neither fetches nor announces anything, so a game that hands a URL
     * to an `<img>` or a stylesheet rather than fetching it does not invent an
     * event for a load this loader never performed. The events stay a record of
     * what the engine itself did.
     */
    resolve(path) {
        if (path === "") {
            throw new Error("asset path is empty");
        }
        if (path.startsWith("/")) {
            throw new Error(`asset path "${path}" escapes the asset root "${this.root}": paths are relative to the root, so it must not start with "/"`);
        }
        if (SCHEME.test(path)) {
            throw new Error(`asset path "${path}" escapes the asset root "${this.root}": an absolute URL is not an asset path`);
        }
        if (path.split("/").includes("..")) {
            throw new Error(`asset path "${path}" escapes the asset root "${this.root}": a ".." segment is not allowed`);
        }
        return `${this.root}${path}`;
    }
    /**
     * Loads an asset and hands back the response body untouched.
     *
     * This is the loader for a kind of file the engine has no opinion about. The
     * root rule and the events apply exactly as they do to the typed loaders, so a
     * build's level data is as visible as its textures.
     */
    load(path) {
        return this.attempt(path, (blob) => Promise.resolve(blob));
    }
    /**
     * Loads an image and decodes it to an `ImageBitmap` ready to draw.
     *
     * A host with no `createImageBitmap` fails the load by name rather than
     * throwing a `TypeError` about an undefined global, because "this environment
     * cannot decode images" and "that file is missing" are different reports and
     * only one of them is the build's fault.
     */
    loadImage(path) {
        return this.attempt(path, async (blob) => {
            // Typed as the one-argument form rather than as `typeof createImageBitmap`:
            // the real global is overloaded, and an overloaded value called through
            // `call` resolves to its last signature, which takes a crop rectangle.
            const decoder = globalThis.createImageBitmap;
            if (!decoder) {
                throw new Error(`asset "${path}" could not be decoded as an image: this host has no createImageBitmap`);
            }
            return await decoder.call(globalThis, blob);
        });
    }
    /**
     * Loads an audio file and decodes it to an `AudioBuffer` ready to play.
     *
     * The same reasoning as {@link loadImage}: a host with no Web Audio rejects
     * with a reason that names the host, so a silent build can be told apart from
     * a build whose sound never arrived.
     */
    loadAudio(path) {
        return this.attempt(path, async (blob) => {
            this.audioContext ??= this.audioContextFactory();
            const context = this.audioContext;
            if (!context) {
                throw new Error(`asset "${path}" could not be decoded as audio: this host has no AudioContext`);
            }
            return await context.decodeAudioData(await blob.arrayBuffer());
        });
    }
    /**
     * The shared body of all three loaders: resolve, fetch, decode, announce once.
     *
     * Every loader routes through here so a path refused by one is refused
     * identically by all of them, and so the "exactly one event per call" rule is a
     * property of one function rather than a convention three of them keep.
     *
     * The success event is emitted *after* the try block on purpose. Emitting it
     * inside would let a subscriber that throws turn a load that succeeded into one
     * that also reported a failure, which is the one shape an observer must never
     * have to reason about.
     */
    async attempt(path, decode) {
        let url;
        try {
            url = this.resolve(path);
        }
        catch (error) {
            // A refused path has no URL by definition, and an empty one is the
            // unambiguous signature of a path the engine rejected rather than a file
            // that resolved and was missing.
            this.emit("asset:failed", { path, url: "", reason: reasonOf(error) });
            throw error;
        }
        let value;
        try {
            const response = await this.fetcher(url);
            if (!response.ok) {
                throw new Error(`asset "${path}" failed to load from "${url}": HTTP ${response.status}`);
            }
            value = await decode(await response.blob());
        }
        catch (error) {
            // Rejections travel unchanged rather than wrapped, so the caller sees the
            // real cause — the HTTP status, the network error, the decode error —
            // while the event keeps its uniform shape.
            this.emit("asset:failed", { path, url, reason: reasonOf(error) });
            throw error;
        }
        this.emit("asset:loaded", { path, url });
        return value;
    }
}
//# sourceMappingURL=assets.js.map