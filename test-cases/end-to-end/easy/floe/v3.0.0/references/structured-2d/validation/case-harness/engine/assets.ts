// What a browser gives an engine's asset loader, and Node does not.
//
// WHY A HARNESS HAS TO SUPPLY THIS AT ALL. Under an engine a check runs in the
// same process as the build, so there is no page — and a page is where a produced
// file comes from. The engines' asset loaders all do the same thing: resolve a
// path under the case's asset root into a URL RELATIVE to the page
// (`assets/models/ring.glb`), hand it to `globalThis.fetch`, and decode what comes
// back. Node's `fetch` refuses a relative URL outright, there is no
// `createImageBitmap` to decode a sprite with, and there is no `AudioContext` to
// decode a cue with (that half is `./audio`).
//
// So without this every produced sprite, model and sound would fail to load in
// every engine project — and a build whose `initialize` awaits its loads, which is
// what the specifications tell a build to write, would never initialize at all.
// That would fail EVERY item in the project for a fact about NODE rather than
// about the build, which is the worst verdict a validator can reach.
//
// WHAT IS SERVED, AND WHAT IS NOT. A relative URL is read off disk, under the
// workspace, at the first of {@link AssetHostOptions.roots} that carries it — the
// same tree the built site would have served it from. Anything carrying a SCHEME
// is handed to the platform's own `fetch` untouched, so nothing else in the
// process can tell this is here. A URL that climbs out of the workspace is
// refused with a `400` and never read: the shim stands in for a static server, and
// a static server does not serve a caller's whole filesystem.
//
// THIS MODULE IS DIMENSION-NEUTRAL, and is in `./index` rather than in `./2d` or
// `./3d`, because both halves need it for the same reason and neither needs a
// different one: a 2D case loads produced sprites and cues through it, a 3D case
// loads produced glTF and cues through it, and the transport is the same
// transport. Only the two OPT-IN shims below lean on `@napi-rs/canvas`, which
// `./canvas` already puts in the neutral barrel for a 3D case's screen layer.
//
// NOTHING HERE DERIVES A PATH FROM THIS PACKAGE'S OWN `import.meta.url`. The
// package is staged one directory DEEPER than the case's files, so a root derived
// here would address a tree one level too far down and every produced file would
// quietly 404. {@link AssetHostOptions.workspaceRoot} is required and comes from
// the case.

import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";

import { Image, loadImage } from "@napi-rs/canvas";

import { cloneKeeping } from "./clone";
import { createHostCanvas } from "./fonts";

/* -------------------------------------------------------------------------- */
/* Where a page-relative URL is looked for                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where a page-relative asset URL is looked for, in order, when a case names no
 * order of its own.
 *
 * THE ORDER IS LOAD-BEARING AND THE CASES DISAGREE ABOUT IT, which is why it is a
 * config value rather than a constant this module imposes. A build is free to
 * arrange its produced tree, and the first root that carries a path WINS — so a
 * case whose specification commits produced files under the repository root and
 * a case whose specification commits them under `public/` are reading different
 * files whenever both trees carry the same path. The four harnesses this was
 * extracted from bind, respectively, `[".", "public", "dist"]` (orrery, gantry's
 * `structured-3d`), `["public", "dist", "."]` (volute) and `["", "public", "dist"]`
 * (gantry's `simple-3d`, where `""` is the same root as `"."`).
 *
 * This default is the majority of those and the one a specification that says
 * "every produced file is committed under the asset root" implies: the committed
 * tree first, then the two places a build may have staged it for Vite. A case
 * whose specification says `public/` FIRST must say so, and saying so is one
 * field.
 */
export const DEFAULT_ASSET_ROOTS: readonly string[] = [".", "public", "dist"];

/* -------------------------------------------------------------------------- */
/* What the shim saw                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One request the build made through the shim, in the order it made it.
 *
 * A SUPERSET OF GANTRY'S `AssetRequest`, member for member, plus the file that
 * answered it. Recording costs a case that never reads it one small object per
 * fetch, and a case that does read it — "which file did the build actually ask
 * for?" — has no other way to know: under an engine this shim IS the whole of the
 * build's transport, where under `none` the same reading comes off the page's own
 * resource timings.
 */
export interface AssetRequest {
  /** The URL as the build wrote it, before anything here resolved it. */
  readonly url: string;
  /**
   * Whether it carries a scheme, which is what "outside its own tree" is here:
   * the shim answers a relative URL out of the workspace, exactly as the static
   * server the built site is served by would, and hands anything with a scheme to
   * the platform's own `fetch` — the network.
   */
  readonly offOrigin: boolean;
  /**
   * The status the shim answered with, or `0` for a request it handed on.
   *
   * `200` is a file it served, `404` one the built tree does not carry, `400` one
   * whose URL climbed out of the workspace, and `0` one that went to the platform
   * — either because it carried a scheme, or because
   * {@link AssetHostOptions.onMissing} is `"upstream"` and no root held it.
   */
  readonly status: number;
  /** The file that answered it, or `null` for anything not read off disk. */
  readonly file: string | null;
}

/* -------------------------------------------------------------------------- */
/* What a case asks for                                                       */
/* -------------------------------------------------------------------------- */

/** What the shim answers for a relative URL no root carries. */
export type MissingAssetPolicy = "404" | "upstream";

/** What a case tells the host about itself. */
export interface AssetHostOptions {
  /**
   * The build's repository root, which every root below is resolved under.
   *
   * REQUIRED, and never derived here — see this module's header. A case takes it
   * off its own `import.meta.url`, which is the only file URL that names the
   * case's tree rather than the staged package inside it.
   */
  readonly workspaceRoot: string;
  /**
   * Where a page-relative URL is looked for, in order. Defaults to
   * {@link DEFAULT_ASSET_ROOTS}; `""` and `"."` are the same root.
   */
  readonly roots?: readonly string[];
  /**
   * What to answer for a relative URL no root carries. Defaults to `"404"`.
   *
   * `"404"` is what a served page answers, and it is what makes an engine
   * announce `asset:failed` with a status — so a build that did not produce a
   * required file still fails the items about that file, and only those.
   * `"upstream"` hands the URL to the platform's own `fetch` instead, which is
   * what orrery and volute do; Node's `fetch` then rejects on the relative URL,
   * so the load fails with a parse error rather than with a status.
   */
  readonly onMissing?: MissingAssetPolicy;
  /**
   * Who a thrown message names. Defaults to `"case-harness"`; a case passing its
   * slug gets the account its own harness used to write.
   */
  readonly label?: string;
  /**
   * Also shim `createImageBitmap`, and name the decoded image type as
   * `globalThis.ImageBitmap`. Defaults to `false`.
   *
   * A 2D case that loads produced SPRITES needs it — the engine's loader decodes
   * a fetched body through `createImageBitmap`, and the recorder recognizes a
   * drawable source by `instanceof` against the host's own constructors, of which
   * a bare Node process has none. A 3D case that loads glTF and decodes it in the
   * engine needs neither.
   *
   * Also replaces `structuredClone` with one that carries a decoded image
   * across by reference, as a browser's `ImageBitmap` survives a clone and the
   * canvas library's `Image` does not — a build that keeps its sprites in its
   * state and clones the state to build the next one would otherwise throw at
   * its first pose. Installed whatever {@link AssetHostOptions.nameImageBitmap}
   * says.
   */
  readonly images?: boolean;
  /**
   * Name the decoded image type as `globalThis.ImageBitmap`. Defaults to
   * whatever {@link AssetHostOptions.images} is.
   *
   * The two are separable because facet shims the decode and deliberately leaves
   * the NAME alone, while orrery, volute, kessler and wick define it: a recorder
   * that interns drawn images recognizes a source by `instanceof` against the
   * host's constructors, so defining it changes what a RECORDING carries. Only
   * ever defined where the host has none.
   */
  readonly nameImageBitmap?: boolean;
  /**
   * Serve only relative URLs whose path begins with this prefix, and hand every
   * other relative URL to the platform. Defaults to serving every relative URL.
   *
   * Arc-foundry's harness serves `assets/` and nothing else, deliberately: its
   * project's own module graph is loaded by vite rather than fetched, and a shim
   * that answered every relative URL would answer for those too. The prefix is
   * matched against the path AFTER the query and any leading `./` or `/` are
   * dropped, so `"assets/"` matches `./assets/x.png` and `/assets/x.png` alike.
   */
  readonly onlyUnder?: string;
  /**
   * Also shim `document.createElement("canvas")`. Defaults to `false`.
   *
   * A build is free to compose a picture on a scratch canvas of its own before it
   * blits that canvas over the frame, and a browser hands one out through
   * `document.createElement`. Nothing else of a document is supplied, because
   * nothing else is something an engine's own runtime would give a build either.
   * Orrery installs this; volute does not, and a build that never asks for one
   * cannot tell the difference.
   */
  readonly documentElement?: boolean;
}

/**
 * The installed host, and the only handle on it.
 *
 * Held for the WORKER, not for a harness: the shims are global, so the log spans
 * every harness a worker built. {@link AssetHost.mark} and
 * {@link AssetHost.clear} are the two ways a harness reads its own build's
 * traffic out of that.
 */
export interface AssetHost {
  /** Every request the shim has seen since the last {@link AssetHost.clear}. */
  requests(): readonly AssetRequest[];
  /** The same, as the URLs alone, oldest first. */
  urls(): readonly string[];
  /** Where the log stands now, so a harness can read only what follows. */
  mark(): number;
  /** Every request logged after `mark`. */
  requestsSince(mark: number): readonly AssetRequest[];
  /** Drop the log, which is what a harness that owns the process does instead. */
  clear(): void;
  /** The URL a decoded image was fetched from, or `null` for one nothing fetched. */
  sourceOf(image: object): string | null;
  /**
   * Put every global back exactly as it was found, and let a later install run.
   *
   * Idempotent. See this module's header on what a second install does.
   */
  uninstall(): void;
}

/* -------------------------------------------------------------------------- */
/* Replacing a global, and putting it back                                    */
/* -------------------------------------------------------------------------- */

/** The process's globals, as a bag this module may write into. */
const host = globalThis as unknown as Record<string, unknown>;

/** Overwrite `name`, answering the function that puts back what was there. */
function replaceGlobal(name: string, value: unknown): () => void {
  const had = Object.getOwnPropertyDescriptor(host, name);
  Object.defineProperty(host, name, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return () => {
    if (had === undefined) delete host[name];
    else Object.defineProperty(host, name, had);
  };
}

/** Define `name` only where the host has none, so a real one is left alone. */
function defineGlobal(name: string, value: unknown): () => void {
  if (host[name] !== undefined) return () => {};
  return replaceGlobal(name, value);
}

/* -------------------------------------------------------------------------- */
/* Resolving a page-relative URL onto the workspace                           */
/* -------------------------------------------------------------------------- */

/** Anything carrying a scheme is the network's, not this shim's. */
const OFF_ORIGIN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** What a URL resolved to: the file that holds it, or why nothing does. */
export type AssetResolution =
  /** A root carries it, and `file` is the one that answered. */
  | { readonly kind: "served"; readonly file: string }
  /** It climbed out of the workspace, which is refused outright. */
  | { readonly kind: "escaped" }
  /**
   * It is not this shim's to answer: an empty path, or one outside
   * {@link AssetHostOptions.onlyUnder}. Handed to the platform whatever
   * {@link AssetHostOptions.onMissing} says.
   */
  | { readonly kind: "unclaimed" }
  /** It is this shim's and no root carries it. */
  | { readonly kind: "missing" };

/**
 * What a page-relative URL resolves to, and why.
 *
 * Exported because it is the whole of the shim's routing and it is worth being
 * able to ask it a question without installing anything.
 *
 * The query and the fragment are dropped first, because a loader may cache-bust a
 * produced file and the file on disk carries no `?v=2`. A leading `./` or `/` is
 * dropped too: both spell "the root of the served tree", which is the workspace.
 *
 * THE CLIMB CHECK IS OVER THE URL, NOT OVER THE CANDIDATE. A path that normalizes
 * to one starting `..` is refused whichever root it would have been joined under,
 * so a case is free to name a root outside the workspace without every request
 * being refused for containment.
 */
export function resolveAsset(
  url: string,
  workspaceRoot: string,
  roots: readonly string[] = DEFAULT_ASSET_ROOTS,
  onlyUnder = "",
): AssetResolution {
  const withoutQuery = url.split(/[?#]/)[0] ?? "";
  const path = withoutQuery.replace(/^\.?\//, "");
  if (path === "") return { kind: "unclaimed" };

  const relative = normalize(path);
  if (
    relative === "." ||
    relative === ".." ||
    relative.startsWith(`..${sep}`) ||
    isAbsolute(relative)
  ) {
    return { kind: "escaped" };
  }

  // THE PREFIX IS TESTED AFTER THE CLIMB IS COLLAPSED, not before. Tested first,
  // `assets/../src/main.ts` begins with `assets/` and would be served out of the
  // project's own source tree — which is the one thing the prefix exists to stop.
  if (
    onlyUnder !== "" &&
    !relative.split(sep).join("/").startsWith(onlyUnder)
  ) {
    return { kind: "unclaimed" };
  }

  for (const root of roots) {
    const candidate = join(workspaceRoot, root, relative);
    try {
      // A stat, not a read: this function is documented as one a case may ask
      // without installing anything, and reading a multi-megabyte model to prove
      // it exists — and then reading it again to serve it — is what the harness
      // this came from did NOT do. `isFile` rather than mere existence, so a path
      // that names a directory falls through to the next root instead of being
      // served as one.
      if (statSync(candidate).isFile())
        return { kind: "served", file: candidate };
    } catch {
      // Not there, or not readable; try the next place the build may have put it.
    }
  }
  return { kind: "missing" };
}

/* -------------------------------------------------------------------------- */
/* The body a served file comes back as                                       */
/* -------------------------------------------------------------------------- */

/** Where a fetched body came from, so a decoded image can carry its source. */
const blobSource = new WeakMap<object, string>();

/** Where a decoded image came from, or absent for one the build painted itself. */
const imageSource = new WeakMap<object, string>();

/**
 * A real `Response` over the bytes on disk, whose `blob()` is stable and tagged.
 *
 * A REAL `Response` RATHER THAN AN OBJECT SHAPED LIKE ONE, because it is a strict
 * superset: `ok`, `status`, `arrayBuffer()` and `blob()` are all there, and so are
 * `headers`, `text()` and `json()` for a loader that reaches past the four.
 *
 * WITH ONE OWN PROPERTY OVER THE TOP OF IT. A real `Response`'s body may be read
 * once, and mints a NEW `Blob` each time `blob()` is called — and image
 * attribution needs the opposite of both: the same `Blob` every time, so the URL
 * it came from can be looked up by identity when `createImageBitmap` is handed it.
 * So `blob` is shadowed with one that answers a single tagged `Blob` and consumes
 * nothing, which also leaves `arrayBuffer()` working afterwards.
 */
function servedResponse(bytes: Uint8Array, url: string): Response {
  // `BodyInit` does not admit a `Uint8Array<ArrayBufferLike>` in this TypeScript,
  // though the runtime takes one; the buffer it views is the same bytes.
  const response = new Response(bytes.buffer as ArrayBuffer, {
    status: 200,
    statusText: "OK",
  });
  let blob: Blob | undefined;
  Object.defineProperty(response, "blob", {
    value: (): Promise<Blob> => {
      if (blob === undefined) {
        blob = new Blob([bytes as unknown as BlobPart]);
        blobSource.set(blob, url);
      }
      return Promise.resolve(blob);
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return response;
}

/* -------------------------------------------------------------------------- */
/* Installing, and taking it back down                                        */
/* -------------------------------------------------------------------------- */

/** Every option with its default filled in, which is what an install is keyed by. */
interface SettledOptions {
  readonly workspaceRoot: string;
  readonly roots: readonly string[];
  readonly onMissing: MissingAssetPolicy;
  readonly label: string;
  readonly images: boolean;
  readonly nameImageBitmap: boolean;
  readonly onlyUnder: string;
  readonly documentElement: boolean;
}

/** The one installation a worker has, and everyone still holding it. */
interface Installation {
  readonly settled: SettledOptions;
  /** Every request the shim has seen, oldest first. Replaced by `clear`. */
  log: AssetRequest[];
  /** What puts each global back, newest first. */
  readonly restores: (() => void)[];
  /** How many un-uninstalled handles are out. The globals go back at zero. */
  users: number;
}

/** What one worker has installed, or `null` for one that has installed nothing. */
let standing: Installation | null = null;

/**
 * The fields a second install may not disagree with the first about.
 *
 * `label` is not among them: it names the case in a thrown message and changes
 * nothing about what is served, so two projects that disagree about it disagree
 * about nothing that could decide a point. `roots` is checked separately, being
 * an array.
 */
const SETTLED_FIELDS = [
  "workspaceRoot",
  "onMissing",
  "images",
  "nameImageBitmap",
  "onlyUnder",
  "documentElement",
] as const;

/** Whether a second call's options say the same thing as the standing one's. */
function disagreement(
  held: SettledOptions,
  asked: SettledOptions,
): string | null {
  for (const field of SETTLED_FIELDS) {
    const a: string | boolean = held[field];
    const b: string | boolean = asked[field];
    if (a !== b) {
      return `${field} ${JSON.stringify(a)}, this call asks for ${JSON.stringify(b)}`;
    }
  }
  if (
    held.roots.length !== asked.roots.length ||
    held.roots.some((root, at) => root !== asked.roots[at])
  ) {
    return `roots ${JSON.stringify(held.roots)}, this call asks for ${JSON.stringify(asked.roots)}`;
  }
  return null;
}

/** Stand the globals up, answering the restores that put them back. */
function shim(settled: SettledOptions, installation: Installation): void {
  const restores = installation.restores;

  const upstream =
    typeof host.fetch === "function"
      ? (host.fetch as typeof globalThis.fetch).bind(globalThis)
      : null;

  const shimmed = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    const offOrigin = OFF_ORIGIN.test(url);
    const record = (status: number, file: string | null): void => {
      installation.log.push({ url, offOrigin, status, file });
    };
    const handOn = async (): Promise<Response> => {
      record(0, null);
      if (upstream === null) {
        throw new Error(`${settled.label}: nothing to fetch "${url}" with`);
      }
      return upstream(input, init);
    };

    if (offOrigin) return handOn();

    const resolved = resolveAsset(
      url,
      settled.workspaceRoot,
      settled.roots,
      settled.onlyUnder,
    );
    if (resolved.kind === "escaped") {
      record(400, null);
      return new Response(null, { status: 400, statusText: "Bad Request" });
    }
    if (resolved.kind === "unclaimed") return handOn();

    // The ONE read of the file, here rather than in the resolver above.
    let bytes: Uint8Array | null = null;
    if (resolved.kind === "served") {
      try {
        bytes = new Uint8Array(readFileSync(resolved.file));
      } catch {
        // It was there a moment ago and is not readable now, which is the same
        // answer to the build as its never having been there.
        bytes = null;
      }
    }
    if (bytes === null) {
      if (settled.onMissing === "upstream") return handOn();
      record(404, null);
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    record(200, resolved.kind === "served" ? resolved.file : null);
    return servedResponse(bytes, url);
  };

  restores.push(replaceGlobal("fetch", shimmed as typeof globalThis.fetch));

  if (settled.nameImageBitmap) {
    // The type name an engine's own recorder looks a drawable source up under. It
    // shadows every `drawImage` a frame issues so a replay can carry the picture
    // the build actually drew, and it recognizes a source by `instanceof` against
    // the host's own constructors — of which a bare Node process has none. Naming
    // the canvas library's decoded image as `ImageBitmap`, which is exactly what
    // `createImageBitmap` hands back here, is what lets a produced sprite reach a
    // recording as its pixels rather than as an opaque marker.
    restores.push(defineGlobal("ImageBitmap", Image));
  }

  if (settled.images) {
    restores.push(
      replaceGlobal("createImageBitmap", async (blob: Blob) => {
        const bytes = Buffer.from(await blob.arrayBuffer());
        const image = await loadImage(bytes);
        const from = blobSource.get(blob);
        if (from !== undefined) imageSource.set(image, from);
        return image as unknown as ImageBitmap;
      }),
    );
    // A browser's `ImageBitmap` survives `structuredClone`; the canvas
    // library's `Image` does not, and a build that keeps its sprites in its
    // state and clones the state to build the next one — which the
    // specifications permit — would throw `DataCloneError` at its first pose.
    // Carried by reference: see `./clone`. Installed whether or not the type is
    // NAMED, because a build clones its state either way.
    restores.push(
      replaceGlobal(
        "structuredClone",
        cloneKeeping((value) => value instanceof Image, structuredClone),
      ),
    );
  }

  if (settled.documentElement) {
    restores.push(
      defineGlobal("document", {
        createElement(tag: string): unknown {
          if (String(tag).toLowerCase() !== "canvas") {
            throw new Error(
              `${settled.label}: this process has no document element "${tag}"`,
            );
          }
          // Its 2D context resolves fonts as the screen's does (`./fonts`), so
          // text a build draws or measures off-screen meets the same faces.
          return createHostCanvas(1, 1);
        },
      }),
    );
  }
}

/** One caller's view of the standing installation, with its own teardown. */
function handleOn(installation: Installation): AssetHost {
  let spent = false;
  return {
    requests: () => installation.log,
    urls: () => installation.log.map((entry) => entry.url),
    mark: () => installation.log.length,
    requestsSince: (at) => installation.log.slice(Math.max(0, at)),
    clear: () => {
      installation.log = [];
    },
    sourceOf: (image) => imageSource.get(image) ?? null,
    uninstall: () => {
      if (spent) return;
      spent = true;
      if (standing !== installation) return;
      installation.users -= 1;
      if (installation.users > 0) return;
      standing = null;
      for (const restore of installation.restores.reverse()) restore();
      installation.restores.length = 0;
    },
  };
}

/**
 * Give this process the transport a browser gives an engine's asset loader.
 *
 * ONE INSTALLATION PER WORKER, SHARED, AND REFERENCE COUNTED. The shims go onto
 * `globalThis`, which is the whole of the process a worker's suites run in, so a
 * second call does not install a second host: it joins the standing one and
 * answers a fresh handle over the same log. Every handle's `uninstall` takes ONE
 * user off, and the globals go back only when the last of them does — which is
 * what a project that installs from `createHarness` and uninstalls from `dispose`
 * needs, because two overlapping harnesses would otherwise have the first
 * `dispose` pull the shim out from under the second.
 *
 * A SECOND CALL THAT DISAGREES THROWS, naming the field and both values, rather
 * than quietly serving the first caller's tree. The root ORDER decides which file
 * answers whenever two roots carry the same path, so two projects in one worker
 * with different roots would silently read each other's files, and nothing type
 * checks a case's validator tree before it runs — that has nowhere else to
 * surface. Two harnesses of the SAME project always agree, because the options
 * come from one config object.
 *
 * TEARDOWN. {@link AssetHost.uninstall} is idempotent per handle: the second call
 * on one handle does nothing, so it is safe in an `afterEach` that also ran in an
 * `afterAll`. When the last handle goes, every global is restored to the
 * descriptor that was found — which on a bare Node process means DELETING all of
 * them, since none existed — and a later {@link installAssetHost} installs afresh.
 * Nothing calls it automatically: a worker that simply exits leaves the shims
 * standing, which is what most of the harnesses this came from do and what makes
 * them cheap.
 */
export function installAssetHost(options: AssetHostOptions): AssetHost {
  const settled: SettledOptions = {
    workspaceRoot: options.workspaceRoot,
    roots: options.roots ?? DEFAULT_ASSET_ROOTS,
    onMissing: options.onMissing ?? "404",
    label: options.label ?? "case-harness",
    images: options.images ?? false,
    nameImageBitmap: options.nameImageBitmap ?? options.images ?? false,
    onlyUnder: options.onlyUnder ?? "",
    documentElement: options.documentElement ?? false,
  };

  if (standing !== null) {
    const differs = disagreement(standing.settled, settled);
    if (differs !== null) {
      throw new Error(
        `case-harness: an asset host is already installed in this worker with ${differs}`,
      );
    }
    standing.users += 1;
    return handleOn(standing);
  }

  const installation: Installation = {
    settled,
    log: [],
    restores: [],
    users: 1,
  };
  shim(settled, installation);
  standing = installation;
  return handleOn(installation);
}

/**
 * A READ-ONLY view of the host this worker has standing, or `null` for none.
 *
 * For a suite that wants to read the log without holding the handle its harness
 * built. It takes no reference, and BOTH members that would change the standing
 * host do nothing through it: `uninstall`, so reading cannot pull the shims down
 * under the harness that installed them, and `clear`, so reading cannot empty the
 * traffic record that harness is about to read. Both are the job of the handle
 * {@link installAssetHost} answered.
 */
export function standingAssetHost(): AssetHost | null {
  if (standing === null) return null;
  return { ...handleOn(standing), clear: () => {}, uninstall: () => {} };
}
