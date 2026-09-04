/**
 * Asset loading: a game names a path, the engine decides the URL — and decides
 * what the bytes become.
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
 * Decoding lives here rather than in the game. A 3D game needs four kinds of file
 * and each arrives as the value the rest of the engine already takes: an
 * `ImageBitmap` the screen layer draws, a `THREE.Texture` a material samples, a
 * {@link Model} whose node tree is cloned into the scene, and an `AudioBuffer` a
 * cue plays. `load` is the generic beneath them, for the fifth kind of file —
 * level data, an atlas description — that keeps the root rule and the events
 * without the engine having to know what the bytes mean.
 *
 * Three decisions inside the typed loaders are worth the reader's attention,
 * because none of them is recoverable from the signatures:
 *
 * - **A texture is decoded already flipped, and says so.** three ignores
 *   `Texture.flipY` for an `ImageBitmap` source — the orientation has to be chosen
 *   when the bitmap is *created* — so `loadTexture` asks for a flipped bitmap and
 *   then tells the texture the flip has already happened. The result matches what
 *   three's own `TextureLoader` produces for the same file, which is the
 *   orientation every material a build's author has ever written assumes.
 * - **glTF decoding is three's `GLTFLoader`, handed bytes this module already
 *   fetched.** The file itself therefore travels over the injected fetcher, like
 *   every other asset, and the root rule and the events apply to it. A `.gltf` that
 *   references side files — an external `.bin`, an external image — has those
 *   fetched by three itself, relative to the *directory* of the resolved URL, so
 *   they still land under the asset root even though this module never sees the
 *   requests. The `.glb` the voxel binaries emit is self-contained and does not
 *   reach that path at all.
 * - **A model arrives even when its textures do not.** A rig with one bare
 *   material is a rig a game can place and a check can inspect, where a rejected
 *   load is nothing at all. three's own loader already leaves the material's `map`
 *   unset in that case and resolves, and this module does not second-guess it.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeletal } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { EngineEventMap, Model } from "./contract";

/** The directory every asset path is resolved under when none is given. */
const DEFAULT_ROOT = "assets/";

/**
 * Matches a leading URI scheme (`http:`, `data:`, `blob:`). Such a path names a
 * location outside the root as surely as a `..` segment does, so it is refused on
 * the same grounds.
 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The two events a load can announce. */
type AssetEventName = "asset:loaded" | "asset:failed";

/**
 * How the loader announces an attempt.
 *
 * A plain function rather than an event-bus object: the loader needs to *say*
 * things, not to be subscribed to, and taking the narrowest thing that does the
 * job keeps this module a leaf that a test can drive with a two-line spy.
 */
export type AssetEventEmitter = <K extends AssetEventName>(
  event: K,
  payload: EngineEventMap[K],
) => void;

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

/** The platform's `fetch`, wrapped so it is not called with a detached receiver. */
function defaultFetch(url: string): Promise<Response> {
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
function defaultAudioContext(): AudioContext | null {
  const ctor = (globalThis as { AudioContext?: typeof AudioContext })
    .AudioContext;
  return ctor ? new ctor() : null;
}

/** The message an event's `reason` carries for a thrown value of any shape. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The host's image decoder, or `undefined` where there is none.
 *
 * Typed as a two-argument function rather than as `typeof createImageBitmap`: the
 * real global is overloaded, and an overloaded value called through `call`
 * resolves to its last signature, which takes a crop rectangle.
 */
function imageDecoder():
  | ((blob: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>)
  | undefined {
  return (
    globalThis as {
      createImageBitmap?: (
        blob: Blob,
        options?: ImageBitmapOptions,
      ) => Promise<ImageBitmap>;
    }
  ).createImageBitmap;
}

/**
 * The directory a resolved URL sits in, with its trailing slash, which is the base
 * three resolves a `.gltf`'s relative side files against.
 *
 * A URL with no slash in it at all — a file at the very root of an empty asset
 * root — yields `""`, which three reads as "beside the page", the same place the
 * file itself came from.
 */
function directoryOf(url: string): string {
  return url.slice(0, url.lastIndexOf("/") + 1);
}

/**
 * Every name in a decoded node tree, in traversal order.
 *
 * Carried beside the tree because finding a node otherwise means traversing it,
 * and a game that rigs a hook to a crane arm wants to know at load time whether
 * the arm it expects is in the file at all.
 *
 * Nodes glTF left unnamed contribute nothing: three names them `""`, and a list of
 * empty strings is a list a game can neither search nor report. Every name here is
 * therefore one `getObjectByName` can actually be called with.
 */
function nodeNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((object) => {
    if (object.name !== "") names.push(object.name);
  });
  return names;
}

/**
 * Places a copy of a loaded {@link Model} in the world.
 *
 * A model is a template rather than a thing in the scene: it stays at its rest
 * pose for the life of the game, and a game puts one in the world by cloning it
 * and adding the clone. One template therefore yields as many placed copies as the
 * state names, each posed, animated, and removed on its own, and a clone taken on
 * the nine-hundredth frame starts from the same rest pose as one taken during
 * initialization.
 *
 * The clone is deep and *skeleton-aware*, which is the whole reason this is a
 * function rather than a call to `Object3D.clone`. three's own clone copies a
 * `SkinnedMesh` while leaving it bound to the skeleton it was cloned from, so two
 * crew members cloned from one rig would share one set of bones and walk in
 * lockstep; this rebinds each clone to the bones inside it. Node names survive, so
 * `getObjectByName` finds on a clone the joint the exporter named in the file.
 */
export function cloneModel(model: Model): THREE.Group {
  // `clone` is declared as returning the base `Object3D` because it accepts one,
  // but it reproduces the type of what it was given, and a model's `scene` is
  // always a `Group`.
  return cloneSkeletal(model.scene) as THREE.Group;
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
  private readonly root: string;
  private readonly fetcher: (url: string) => Promise<Response>;
  private readonly emit: AssetEventEmitter;
  private readonly audioContextFactory: () => AudioContext | null;

  /**
   * The one thing the loader remembers, and it is a single slot rather than a
   * collection: decoding a hundred sounds must not build a hundred contexts.
   * Still `null` means the factory has not yielded one *yet* — a host whose
   * context appears later gets asked again.
   */
  private audioContext: AudioContext | null = null;

  /**
   * three's glTF decoder, built on first use and reused after.
   *
   * Reuse is safe because it holds nothing between parses: a `GLTFLoader` is a
   * configuration object, and every cache a decode fills belongs to the parser it
   * builds for that one call. Building it lazily keeps a game that loads no models
   * from paying for three's loader stack at all.
   */
  private gltf: GLTFLoader | null = null;

  constructor(options: AssetLoaderOptions = {}) {
    const root = options.root ?? DEFAULT_ROOT;
    // Normalising the trailing slash here means the root can be written either
    // way at the call site and `resolve` stays a plain concatenation. An empty
    // root is left empty: it means "beside the page", and appending a slash would
    // silently turn every path absolute.
    this.root = root === "" || root.endsWith("/") ? root : `${root}/`;
    this.fetcher = options.fetch ?? defaultFetch;
    this.emit = options.emit ?? (() => {});
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
  resolve(path: string): string {
    if (path === "") {
      throw new Error("asset path is empty");
    }
    if (path.startsWith("/")) {
      throw new Error(
        `asset path "${path}" escapes the asset root "${this.root}": paths are relative to the root, so it must not start with "/"`,
      );
    }
    if (SCHEME.test(path)) {
      throw new Error(
        `asset path "${path}" escapes the asset root "${this.root}": an absolute URL is not an asset path`,
      );
    }
    if (path.split("/").includes("..")) {
      throw new Error(
        `asset path "${path}" escapes the asset root "${this.root}": a ".." segment is not allowed`,
      );
    }
    return `${this.root}${path}`;
  }

  /**
   * Loads an asset and hands back the response body untouched.
   *
   * This is the loader for a kind of file the engine has no opinion about. The
   * root rule and the events apply exactly as they do to the typed loaders, so a
   * build's level data is as visible as its models.
   */
  load(path: string): Promise<Blob> {
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
  loadImage(path: string): Promise<ImageBitmap> {
    return this.attempt(path, (blob) => this.decodeImage(path, blob));
  }

  /**
   * Loads an image and wraps it as a texture ready to assign as a material's
   * `map`.
   *
   * The texture is sRGB, because a color map produced by the asset-generation
   * tools was authored in sRGB and a material that sampled it as linear data would
   * render it washed out. A non-color map — a normal map, a roughness map — is a
   * different kind of file that the game re-tags after loading; sRGB is the right
   * default because color maps are the overwhelming majority and the wrong one is
   * visible immediately.
   *
   * The bitmap is asked for already flipped and the texture is told so. three
   * ignores `Texture.flipY` for an `ImageBitmap`, so a texture built from an
   * unflipped bitmap renders upside down against the same file loaded through
   * three's `TextureLoader`; doing the flip at decode time is how the two agree.
   */
  loadTexture(path: string): Promise<THREE.Texture> {
    return this.attempt(path, async (blob) => {
      const bitmap = await this.decodeImage(path, blob, {
        imageOrientation: "flipY",
      });
      const texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      // Nothing reaches the GPU until a frame draws with it, and the renderer only
      // uploads a texture it has been told is dirty. A texture built by hand is
      // dirty by definition: this is the line without which the material samples
      // nothing.
      texture.needsUpdate = true;
      return texture;
    });
  }

  /**
   * Loads a glTF 2.0 file, `.glb` or `.gltf`, and decodes it to a {@link Model}
   * template.
   *
   * The bytes are fetched here and handed to three already in memory, so the file
   * obeys the root rule and announces itself like every other asset. What three
   * resolves for itself is a `.gltf`'s side files, and the base it resolves them
   * against is the directory the model itself came from — so an external buffer or
   * image lands beside the model, inside the root, rather than beside the page.
   *
   * A file whose glTF decodes but whose textures do not still arrives, with those
   * materials' maps unset: a rig with one bare material is something a game can
   * place and a check can inspect, and the alternative is nothing at all.
   */
  loadModel(path: string): Promise<Model> {
    return this.attempt(path, async (blob, url) => {
      this.gltf ??= new GLTFLoader();
      const decoded = await this.gltf.parseAsync(
        await blob.arrayBuffer(),
        directoryOf(url),
      );
      // glTF permits a file that defines no scene — a library of meshes meant to be
      // referenced rather than placed. three hands that back as an undefined
      // `scene`, and a `Model` whose template is undefined would fail at the point
      // a game cloned it, a long way from the file that caused it.
      if (!decoded.scene) {
        throw new Error(
          `asset "${path}" decoded as glTF but defines no scene to place`,
        );
      }
      return {
        scene: decoded.scene,
        animations: decoded.animations,
        nodes: nodeNames(decoded.scene),
      };
    });
  }

  /**
   * Loads an audio file and decodes it to an `AudioBuffer` ready to play.
   *
   * The same reasoning as {@link loadImage}: a host with no Web Audio rejects
   * with a reason that names the host, so a silent build can be told apart from
   * a build whose sound never arrived.
   */
  loadAudio(path: string): Promise<AudioBuffer> {
    return this.attempt(path, async (blob) => {
      this.audioContext ??= this.audioContextFactory();
      const context = this.audioContext;
      if (!context) {
        throw new Error(
          `asset "${path}" could not be decoded as audio: this host has no AudioContext`,
        );
      }
      return await context.decodeAudioData(await blob.arrayBuffer());
    });
  }

  /**
   * The image decode both {@link loadImage} and {@link loadTexture} run through,
   * so a host that cannot decode images reports itself identically whichever one
   * the game called.
   */
  private async decodeImage(
    path: string,
    blob: Blob,
    options?: ImageBitmapOptions,
  ): Promise<ImageBitmap> {
    const decoder = imageDecoder();
    if (!decoder) {
      throw new Error(
        `asset "${path}" could not be decoded as an image: this host has no createImageBitmap`,
      );
    }
    return await decoder.call(globalThis, blob, options);
  }

  /**
   * The shared body of all five loaders: resolve, fetch, decode, announce once.
   *
   * Every loader routes through here so a path refused by one is refused
   * identically by all of them, and so the "exactly one event per call" rule is a
   * property of one function rather than a convention five of them keep.
   *
   * The success event is emitted *after* the try block on purpose. Emitting it
   * inside would let a subscriber that throws turn a load that succeeded into one
   * that also reported a failure, which is the one shape an observer must never
   * have to reason about.
   */
  private async attempt<T>(
    path: string,
    decode: (blob: Blob, url: string) => Promise<T>,
  ): Promise<T> {
    let url: string;
    try {
      url = this.resolve(path);
    } catch (error) {
      // A refused path has no URL by definition, and an empty one is the
      // unambiguous signature of a path the engine rejected rather than a file
      // that resolved and was missing.
      this.emit("asset:failed", { path, url: "", reason: reasonOf(error) });
      throw error;
    }

    let value: T;
    try {
      const response = await this.fetcher(url);
      if (!response.ok) {
        throw new Error(
          `asset "${path}" failed to load from "${url}": HTTP ${response.status}`,
        );
      }
      value = await decode(await response.blob(), url);
    } catch (error) {
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
