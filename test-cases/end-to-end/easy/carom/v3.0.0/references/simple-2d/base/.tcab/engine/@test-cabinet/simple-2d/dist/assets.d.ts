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
import type { EngineEventMap } from "./contract";
/** The two events a load can announce. */
type AssetEventName = "asset:loaded" | "asset:failed";
/**
 * How the loader announces an attempt.
 *
 * A plain function rather than an event-bus object: the loader needs to *say*
 * things, not to be subscribed to, and taking the narrowest thing that does the
 * job keeps this module a leaf that a test can drive with a two-line spy.
 */
export type AssetEventEmitter = <K extends AssetEventName>(event: K, payload: EngineEventMap[K]) => void;
/** What an {@link AssetLoader} is built over. Every field has a working default. */
export interface AssetLoaderOptions {
    /** The root every path resolves under; defaults to `"assets/"`. */
    root?: string;
    /** The transport; defaults to the platform's `fetch`. */
    fetch?: (url: string) => Promise<Response>;
    /** Where the loader announces each attempt; defaults to announcing nowhere. */
    emit?: AssetEventEmitter;
    /**
     * The context {@link AssetLoader.loadAudio} decodes through, or `null` where the
     * host has no Web Audio.
     *
     * Asked for lazily and only once, because a context is expensive and because a
     * host that has one may not want it built at engine construction time.
     */
    audioContext?: () => AudioContext | null;
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
export declare class AssetLoader {
    private readonly root;
    private readonly fetcher;
    private readonly emit;
    private readonly audioContextFactory;
    /**
     * The one thing the loader remembers, and it is a single slot rather than a
     * collection: decoding a hundred sounds must not build a hundred contexts.
     * Still `null` means the factory has not yielded one *yet* — a host whose
     * context appears later gets asked again.
     */
    private audioContext;
    constructor(options?: AssetLoaderOptions);
    /**
     * Turns a game-supplied path into the URL it loads from, throwing if the path
     * would escape the asset root.
     *
     * Pure: it neither fetches nor announces anything, so a game that hands a URL
     * to an `<img>` or a stylesheet rather than fetching it does not invent an
     * event for a load this loader never performed. The events stay a record of
     * what the engine itself did.
     */
    resolve(path: string): string;
    /**
     * Loads an asset and hands back the response body untouched.
     *
     * This is the loader for a kind of file the engine has no opinion about. The
     * root rule and the events apply exactly as they do to the typed loaders, so a
     * build's level data is as visible as its textures.
     */
    load(path: string): Promise<Blob>;
    /**
     * Loads an image and decodes it to an `ImageBitmap` ready to draw.
     *
     * A host with no `createImageBitmap` fails the load by name rather than
     * throwing a `TypeError` about an undefined global, because "this environment
     * cannot decode images" and "that file is missing" are different reports and
     * only one of them is the build's fault.
     */
    loadImage(path: string): Promise<ImageBitmap>;
    /**
     * Loads an audio file and decodes it to an `AudioBuffer` ready to play.
     *
     * The same reasoning as {@link loadImage}: a host with no Web Audio rejects
     * with a reason that names the host, so a silent build can be told apart from
     * a build whose sound never arrived.
     */
    loadAudio(path: string): Promise<AudioBuffer>;
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
    private attempt;
}
export {};
//# sourceMappingURL=assets.d.ts.map