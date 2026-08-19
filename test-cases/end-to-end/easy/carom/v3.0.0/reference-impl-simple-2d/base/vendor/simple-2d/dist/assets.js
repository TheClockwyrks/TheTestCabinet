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
/** The directory every asset path is resolved under when none is given. */
const DEFAULT_ROOT = "assets/";
/**
 * Matches a leading URI scheme (`http:`, `data:`, `blob:`). Such a path names a
 * location outside the root as surely as a `..` segment does, so it is refused on
 * the same grounds.
 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** The default transport — the platform's `fetch`, bound so it can be passed around. */
function defaultFetcher(url) {
    return globalThis.fetch(url);
}
/**
 * Resolves and loads a game's assets under a fixed root, logging every load.
 *
 * The fetcher is injectable so the loader can be driven without a server (and so
 * a test can produce a failure that a real network cannot be asked for on
 * demand); the root is injectable so the engine, not this class, decides the
 * convention.
 */
export class AssetLoader {
    root;
    fetcher;
    events = [];
    constructor(root = DEFAULT_ROOT, fetcher = defaultFetcher) {
        // Normalising the trailing slash here means the root can be written either
        // way at the call site and `resolve` stays a plain concatenation.
        this.root = root.endsWith("/") ? root : `${root}/`;
        this.fetcher = fetcher;
    }
    /**
     * Turns a game-supplied path into the URL it loads from, throwing if the path
     * would escape the asset root.
     *
     * Pure: it neither fetches nor logs, so a game can compute a URL to hand to an
     * `<img>` or a stylesheet without inventing a log entry for a load that this
     * loader never performed. {@link load} is what records a request.
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
     * Loads an asset as a `Blob`, appending exactly one log entry for the attempt —
     * `ok: true` only once the body has been read in full.
     *
     * Rejections are re-thrown unchanged rather than wrapped, so a caller sees the
     * real cause (a refused path, an HTTP status, a network error) while the log
     * keeps its uniform shape.
     */
    async load(path) {
        let url;
        try {
            url = this.resolve(path);
        }
        catch (error) {
            // A refused path has no URL by definition, and an empty one alongside
            // `ok: false` is the unambiguous signature of a path the engine rejected
            // rather than a file that was missing.
            this.events.push({ path, url: "", ok: false });
            throw error;
        }
        try {
            const response = await this.fetcher(url);
            if (!response.ok) {
                throw new Error(`asset "${path}" failed to load from "${url}": HTTP ${response.status}`);
            }
            const blob = await response.blob();
            this.events.push({ path, url, ok: true });
            return blob;
        }
        catch (error) {
            this.events.push({ path, url, ok: false });
            throw error;
        }
    }
    /**
     * The asset log, oldest first.
     *
     * A copy: the log crosses the host interface to a driver, and a caller must not
     * be able to edit the record of what the build requested.
     */
    log() {
        return [...this.events];
    }
}
