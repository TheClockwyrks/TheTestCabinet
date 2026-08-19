/**
 * Asset loading: a game names a path, the engine decides the URL.
 *
 * Every path resolves under one fixed root (`assets/` by default). That is a
 * deliberate loss of freedom for the game — it cannot reach a CDN, a data URI or
 * a sibling directory — and it buys two things. A build's asset requests all land
 * somewhere a run's produced tree can be inspected, and a driver reading the log
 * can say exactly which files the build asked for and which of them existed,
 * without guessing at the shape of arbitrary URLs.
 *
 * The rule is enforced rather than assumed: a path with a leading slash, a `..`
 * segment, or a scheme is refused outright. Anything else would let a game
 * silently opt out of the root, and an escape hatch that only *some* builds use
 * makes the log unreadable as evidence.
 *
 * A refused path and a missing file are both recorded and then re-thrown. The log
 * is what a driver reads, but the game still needs to know its texture never
 * arrived — swallowing that would leave it rendering nothing with no explanation.
 */
import type { AssetEvent } from "./contract";
/**
 * Resolves and loads a game's assets under a fixed root, logging every load.
 *
 * The fetcher is injectable so the loader can be driven without a server (and so
 * a test can produce a failure that a real network cannot be asked for on
 * demand); the root is injectable so the engine, not this class, decides the
 * convention.
 */
export declare class AssetLoader {
    private readonly root;
    private readonly fetcher;
    private readonly events;
    constructor(root?: string, fetcher?: (url: string) => Promise<Response>);
    /**
     * Turns a game-supplied path into the URL it loads from, throwing if the path
     * would escape the asset root.
     *
     * Pure: it neither fetches nor logs, so a game can compute a URL to hand to an
     * `<img>` or a stylesheet without inventing a log entry for a load that this
     * loader never performed. {@link load} is what records a request.
     */
    resolve(path: string): string;
    /**
     * Loads an asset as a `Blob`, appending exactly one log entry for the attempt —
     * `ok: true` only once the body has been read in full.
     *
     * Rejections are re-thrown unchanged rather than wrapped, so a caller sees the
     * real cause (a refused path, an HTTP status, a network error) while the log
     * keeps its uniform shape.
     */
    load(path: string): Promise<Blob>;
    /**
     * The asset log, oldest first.
     *
     * A copy: the log crosses the host interface to a driver, and a caller must not
     * be able to edit the record of what the build requested.
     */
    log(): AssetEvent[];
}
