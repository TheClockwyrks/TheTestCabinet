// The `AudioContext` a produced `.wav` decodes through, and the RIFF parser under
// it.
//
// WHY AN ENGINE PROJECT NEEDS ONE. Every engine's cue bus degrades to silence on a
// host with no Web Audio and still announces `cue:played`, `cue:looped` and
// `cue:stopped` — which is the whole of what a check reads about sound, because a
// validator has no ears. What does NOT degrade is `api.audio.load(cue, path)`: the
// loader decodes each produced `.wav` through `context.decodeAudioData` and
// refuses outright on a host with no `AudioContext`. The specifications tell a
// build to bind its cues from `initialize`, so on a bare Node process that
// rejection escapes `initialize`, rejects the engine's own initialization, and
// costs the run EVERY item — for a fact about Node rather than about the build.
//
// SO THE DECODE IS REAL AND THE GRAPH IS NOT. The RIFF/WAVE header is genuinely
// parsed: the magic, the `fmt ` chunk's channel count, sample rate and bit depth,
// and the `data` chunk's length are what the buffer reports, so a check that loads
// a cue and reads its duration is reading the file the build produced, and a body
// that is not a PCM `.wav` throws exactly as a browser's `decodeAudioData` does.
// The graph half is inert: every node accepts a connection, a schedule, a start
// and a stop, and none of it sounds.
//
// TWO DECODERS SHIP, NOT ONE, and the difference is not cosmetic — see
// {@link decodeWavChannels} and {@link decodeWavHeader}. The four harnesses this
// came from split two-two on it, so {@link AudioHostOptions.decode} is REQUIRED:
// there is no majority to default to, and defaulting to either would silently
// change what half the cases hand their engine.
//
// THIS MODULE IS DIMENSION-NEUTRAL AND PURE. It reads no file, touches no canvas,
// and imports nothing but types — a 2D case and a 3D case want the same decode of
// the same file format, and neither the WebGL stub nor the 2D readings are
// anywhere near it. The transport that FETCHES the file is `./assets`.

/* -------------------------------------------------------------------------- */
/* Reading the header                                                         */
/* -------------------------------------------------------------------------- */

/** What a `.wav` may be missing and still decode, when a case says so. */
export interface WavDecodeOptions {
  /**
   * Figures to fall back on for a file carrying no usable `fmt ` chunk.
   *
   * ABSENT BY DEFAULT, WHICH THROWS. Orrery and volute fell back on
   * `{ sampleRate: 44100, channels: 1, bitsPerSample: 16 }` and reported those
   * for a file that declared nothing — which is a decode of a file that is not a
   * wave answering plausible figures. Gantry's two threw. A case that wants the
   * lenient reading says so, and says what it is falling back ON.
   */
  readonly defaults?: {
    readonly sampleRate: number;
    readonly channels: number;
    readonly bitsPerSample: number;
  };
  /**
   * Read a file with no `data` chunk as zero frames instead of throwing.
   *
   * Gantry's `simple-3d` did; the other three threw. A zero-length buffer binds
   * the cue and plays nothing, so the difference decides an item about a cue whose
   * file carries a header and no samples.
   */
  readonly allowMissingData?: boolean;
}

/**
 * How a `.wav`'s samples are written, as its `fmt ` chunk declares.
 *
 * `"pcm"` is `WAVE_FORMAT_PCM` (1) and `"float"` is `WAVE_FORMAT_IEEE_FLOAT` (3).
 * `WAVE_FORMAT_EXTENSIBLE` (0xFFFE) declares the real one in its extension's
 * sub-format GUID, whose first two bytes are the tag, so it is read through to
 * whichever of the two it names.
 */
export type WavSampleFormat = "pcm" | "float";

/** The `fmt ` chunk's figures and where the samples are, as the file declares them. */
interface WavLayout {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  readonly format: WavSampleFormat;
  /** The `data` chunk's body, or an empty view for a file that carries none. */
  readonly data: Uint8Array;
  /** Whole sample frames the body holds. */
  readonly frames: number;
}

/** The four bytes at `at`, as the tag a RIFF chunk is named by. */
function tagAt(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

/**
 * Walk a RIFF/WAVE file for its format and its samples.
 *
 * CHUNK-WALKED RATHER THAN READ AT FIXED OFFSETS, because a produced file may
 * carry a `LIST` or a `fact` chunk between `fmt ` and `data` and a fixed-offset
 * reader would report nonsense for it. Chunks are word-aligned, so an odd size
 * carries one pad byte.
 *
 * The `WAVE` tag is checked as well as `RIFF`. Two of the four harnesses this came
 * from checked only `RIFF`, which would walk a RIFF file of some other form —
 * an AVI, say — and report whatever its chunks happened to spell; a file that is
 * not a wave is not a cue, and saying so at the magic is the honest verdict.
 */
function readWav(bytes: Uint8Array, options: WavDecodeOptions): WavLayout {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 12 ||
    tagAt(view, 0) !== "RIFF" ||
    tagAt(view, 8) !== "WAVE"
  ) {
    throw new Error("not a RIFF/WAVE file");
  }

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let tag = 0;
  let data: Uint8Array | null = null;

  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = tagAt(view, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= bytes.byteLength) {
      tag = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
      // `WAVE_FORMAT_EXTENSIBLE` names the real format in the first two bytes of
      // its sub-format GUID, 24 bytes into the chunk.
      if (tag === 0xfffe && size >= 40 && body + 26 <= bytes.byteLength) {
        tag = view.getUint16(body + 24, true);
      }
    } else if (id === "data") {
      data = bytes.subarray(body, Math.min(body + size, bytes.byteLength));
    }
    at = body + size + (size % 2);
  }

  if (sampleRate <= 0 || channels <= 0 || bitsPerSample <= 0) {
    const fallback = options.defaults;
    if (fallback === undefined) throw new Error("no usable `fmt ` chunk");
    // EACH FIELD ON ITS OWN, not all three because one of them was missing: a
    // `fmt ` declaring a rate and a depth but no channel count reports the rate
    // and the depth it declared, which is what orrery and volute did.
    if (sampleRate <= 0) sampleRate = fallback.sampleRate;
    if (channels <= 0) channels = fallback.channels;
    if (bitsPerSample <= 0) bitsPerSample = fallback.bitsPerSample;
    if (tag === 0) tag = 1;
  }
  if (data === null) {
    if (options.allowMissingData !== true) {
      throw new Error("the file carries no `data` chunk");
    }
    data = new Uint8Array(0);
  }

  const bytesPerFrame = Math.max(1, bitsPerSample >> 3) * channels;
  return {
    sampleRate,
    channels,
    bitsPerSample,
    format: tag === 3 ? "float" : "pcm",
    data,
    frames: Math.floor(data.byteLength / bytesPerFrame),
  };
}

/**
 * One sample, in `[-1, 1]`, at `at` bytes into the `data` chunk.
 *
 * THE DEPTHS THE ASSET TOOLS CAN WRITE, and the ones a build may hand back:
 * unsigned 8-bit, signed 16-, 24- and 32-bit integer PCM, and 32- and 64-bit
 * IEEE float. A depth outside those reads as zero rather than as nonsense, so a
 * check reads {@link WavChannels.bitsPerSample} to know rather than inferring it
 * from silence.
 */
function sampleAt(
  view: DataView,
  at: number,
  bitsPerSample: number,
  format: WavSampleFormat,
): number {
  if (format === "float") {
    if (bitsPerSample === 32) return view.getFloat32(at, true);
    if (bitsPerSample === 64) return view.getFloat64(at, true);
    return 0;
  }
  if (bitsPerSample === 8) return (view.getUint8(at) - 128) / 128;
  if (bitsPerSample === 16) return view.getInt16(at, true) / 32768;
  if (bitsPerSample === 24) {
    const raw =
      view.getUint8(at) |
      (view.getUint8(at + 1) << 8) |
      (view.getInt8(at + 2) << 16);
    return raw / 8388608;
  }
  if (bitsPerSample === 32) return view.getInt32(at, true) / 2147483648;
  return 0;
}

/* -------------------------------------------------------------------------- */
/* The two decodes, which are genuinely two                                   */
/* -------------------------------------------------------------------------- */

/** A `.wav`'s figures and its samples, one `Float32Array` per channel. */
export interface WavChannels {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  /** How the samples were written, as the `fmt ` chunk declared. */
  readonly format: WavSampleFormat;
  /** One array per channel, de-interleaved, each `frames` long. */
  readonly frames: Float32Array[];
}

/** A `.wav`'s figures alone, with nothing decoded. */
export interface WavHeader {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  /** How the samples were written, as the `fmt ` chunk declared. */
  readonly format: WavSampleFormat;
  /** Whole sample frames the `data` chunk holds. */
  readonly length: number;
  /** Those frames in seconds. */
  readonly duration: number;
}

/**
 * A `.wav` decoded to its SAMPLES, de-interleaved, one array per channel.
 *
 * THE HALF THAT COSTS SOMETHING, and the half a check may read. Orrery and volute
 * bind this: their engines hand the decoded buffer on, and a check that asks a
 * channel what it holds gets what the build's file holds.
 *
 * EVERY DEPTH THE ASSET TOOLS CAN WRITE IS CONVERTED — see {@link sampleAt}. The
 * four harnesses this was extracted from converted 16-bit alone and read every
 * other depth as silence; a file at any other depth is now decoded rather than
 * zeroed, which is additive for every one of them because a 16-bit file decodes
 * to exactly the samples it did before.
 */
export function decodeWavChannels(
  bytes: Uint8Array,
  options: WavDecodeOptions = {},
): WavChannels {
  const { sampleRate, channels, bitsPerSample, format, data, frames } = readWav(
    bytes,
    options,
  );
  const bytesPerSample = Math.max(1, bitsPerSample >> 3);
  const decoded = Array.from(
    { length: channels },
    () => new Float32Array(frames),
  );
  const samples = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const at = (i * channels + c) * bytesPerSample;
      const channel = decoded[c];
      if (channel !== undefined) {
        channel[i] = sampleAt(samples, at, bitsPerSample, format);
      }
    }
  }
  return { sampleRate, channels, bitsPerSample, format, frames: decoded };
}

/**
 * A `.wav` read for its FIGURES, with nothing decoded.
 *
 * THE HALF THAT COSTS NOTHING, and the half that is enough whenever nothing
 * listens. Gantry's two bind this: their checks read cue EVENTS, which are the
 * engine's own record and not the graph's, so decoding eleven cues per harness for
 * nobody would be the most expensive thing the project did. Everything a caller
 * can observe about a decoded buffer — the rate, the channel count, the frame
 * count and the duration — is still the file's own.
 */
export function decodeWavHeader(
  bytes: Uint8Array,
  options: WavDecodeOptions = {},
): WavHeader {
  const { sampleRate, channels, bitsPerSample, format, frames } = readWav(
    bytes,
    options,
  );
  return {
    sampleRate,
    channels,
    bitsPerSample,
    format,
    length: frames,
    duration: sampleRate === 0 ? 0 : frames / sampleRate,
  };
}

/* -------------------------------------------------------------------------- */
/* The buffer `decodeAudioData` answers                                       */
/* -------------------------------------------------------------------------- */

/**
 * As much of an `AudioBuffer` as an engine's loader reads off one.
 *
 * STRUCTURAL, like everything in `./contract`: nothing here is the DOM's
 * `AudioBuffer`, and an engine that holds one of these holds it through its own
 * type.
 *
 * `copyFromChannel` and `copyToChannel` are carried because gantry's
 * `structured-3d` buffer carried them: no engine is known to call either on a
 * buffer it did not create, and a member that is simply ABSENT throws from inside
 * the build's own tick if one ever does. Copying OUT reads what the buffer holds;
 * copying IN is a no-op, because a decoded cue is the file's and this may hold no
 * samples to write over.
 */
export interface AudioBufferLike {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
  copyFromChannel(
    destination: Float32Array,
    channel: number,
    startInChannel?: number,
  ): void;
  copyToChannel(
    source: Float32Array,
    channel: number,
    startInChannel?: number,
  ): void;
}

/** The two copy members, over whatever `getChannelData` answers. */
function copiers(
  getChannelData: (channel: number) => Float32Array,
): Pick<AudioBufferLike, "copyFromChannel" | "copyToChannel"> {
  return {
    copyFromChannel: (destination, channel, startInChannel = 0) => {
      const held = getChannelData(channel);
      destination.set(
        held.subarray(
          startInChannel,
          Math.min(held.length, startInChannel + destination.length),
        ),
      );
    },
    copyToChannel: () => undefined,
  };
}

/** A decoded `.wav` as the buffer an engine's loader is handed, WITH its samples. */
export function wavAudioBuffer(
  bytes: Uint8Array,
  options: WavDecodeOptions = {},
): AudioBufferLike {
  const { sampleRate, channels, frames } = decodeWavChannels(bytes, options);
  const length = frames[0]?.length ?? 0;
  const getChannelData = (channel: number): Float32Array =>
    frames[channel] ?? new Float32Array(0);
  return {
    sampleRate,
    numberOfChannels: channels,
    length,
    duration: sampleRate === 0 ? 0 : length / sampleRate,
    getChannelData,
    ...copiers(getChannelData),
  };
}

/**
 * The same buffer, of the right length, holding SILENCE.
 *
 * One shared array behind every channel, because nothing may hear it and nothing
 * may write to it: an engine that read two channels and compared them would find
 * them identical, which is true of silence.
 */
export function silentAudioBuffer(
  bytes: Uint8Array,
  options: WavDecodeOptions = {},
): AudioBufferLike {
  const { sampleRate, channels, length, duration } = decodeWavHeader(
    bytes,
    options,
  );
  const silence = new Float32Array(length);
  const getChannelData = (): Float32Array => silence;
  return {
    sampleRate,
    numberOfChannels: channels,
    length,
    duration,
    getChannelData,
    ...copiers(getChannelData),
  };
}

/* -------------------------------------------------------------------------- */
/* The inert graph                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A node of the fake audio graph: every member answers, and none sounds.
 *
 * A `Proxy` rather than a hand-written set of node classes, and for a sharper
 * reason than brevity. An engine's bus builds a real graph the moment it is
 * unlocked — a panner, a gain, a buffer source, an oscillator, a filter, whichever
 * a cue asks for — wires them with `connect`, schedules them through `AudioParam`
 * methods, and starts and stops them. Enumerating that by hand would mean a list
 * to keep in step with the engine's synthesizer, and a member this file had missed
 * would surface as a thrown error inside the build's own tick. Answering
 * everything is the property that matters, so everything is answered.
 *
 * EACH MEMBER IS BOTH CALLABLE AND PARAMETER-SHAPED, because a name alone does not
 * say which it is: `gain.connect(x)` is a method and `gain.gain.value = 0.3` is an
 * `AudioParam`, and one object serves both without this having to know which.
 *
 * AND EACH IS MEMOIZED, so `node.gain` is the same object twice and a value
 * written to it reads back. Gantry's `simple-3d` minted a fresh non-callable
 * parameter per read, under which a schedule written on one read was invisible to
 * the next; this is a superset of that, and of gantry's `structured-3d` node,
 * which is the one it is taken from.
 */
export function inertAudioNode(): Record<string, unknown> {
  const held: Record<string, unknown> = {};
  return new Proxy(held, {
    get(target, property): unknown {
      if (typeof property !== "string") return Reflect.get(target, property);
      if (property in target) return Reflect.get(target, property);
      // A node that answered `then` with a function is a thenable, and an engine
      // that `await`s one would hang on it forever.
      if (property === "then") return undefined;
      const member = ((): unknown => inertAudioNode()) as Record<
        string,
        unknown
      > &
        (() => unknown);
      member.value = 0;
      member.setValueAtTime = (): unknown => member;
      member.linearRampToValueAtTime = (): unknown => member;
      member.exponentialRampToValueAtTime = (): unknown => member;
      member.setTargetAtTime = (): unknown => member;
      member.setValueCurveAtTime = (): unknown => member;
      member.cancelScheduledValues = (): unknown => member;
      target[property] = member;
      return member;
    },
    set(target, property, value): boolean {
      target[property as string] = value;
      return true;
    },
  });
}

/* -------------------------------------------------------------------------- */
/* The context itself                                                         */
/* -------------------------------------------------------------------------- */

/** What a case tells the stand-in context about itself. */
export interface AudioHostOptions {
  /**
   * How a fetched `.wav` becomes the buffer `decodeAudioData` answers.
   *
   * REQUIRED, AND DELIBERATELY SO. {@link wavAudioBuffer} decodes the samples and
   * {@link silentAudioBuffer} does not, the four harnesses this came from split
   * two-two on which, and a case reading a channel it thought was decoded would
   * read silence with nothing to tell it so. There is no majority to default to.
   */
  decode(bytes: Uint8Array): AudioBufferLike;
  /** What `context.sampleRate` reports. Defaults to `48000`. */
  readonly sampleRate?: number;
  /**
   * Replace an `AudioContext` the host already has. Defaults to `false`.
   *
   * A bare Node process has none, so this changes nothing there; it is the switch
   * for a host that really does carry Web Audio, where the real one is the better
   * one and is left alone.
   */
  readonly replace?: boolean;
}

/**
 * The class {@link installAudioContext} installs, for a case that wants to hand
 * one to an engine directly rather than through a global.
 *
 * EVERY MEMBER NOT NAMED ON IT ANSWERS A NODE. `createGain`, `createPanner`,
 * `createBufferSource`, `createOscillator`, whatever the engine's synthesizer
 * reaches for next: the construct trap answers any absent member with a function
 * handing back an {@link inertAudioNode}, so nothing has to be kept in step with
 * the engine's synthesizer.
 */
export function createAudioContextStub(
  options: AudioHostOptions,
): new (...args: never[]) => object {
  const sampleRate = options.sampleRate ?? 48000;
  const decode = options.decode;

  class StubAudioContext {
    readonly sampleRate = sampleRate;
    readonly currentTime = 0;
    readonly state = "running";
    readonly destination = inertAudioNode();
    readonly listener = inertAudioNode();

    resume(): Promise<void> {
      return Promise.resolve();
    }
    suspend(): Promise<void> {
      return Promise.resolve();
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
    decodeAudioData(data: ArrayBuffer | Uint8Array): Promise<AudioBufferLike> {
      try {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        return Promise.resolve(decode(bytes));
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    createBuffer(
      channels: number,
      length: number,
      rate: number,
    ): AudioBufferLike {
      const silence = new Float32Array(length);
      const getChannelData = (): Float32Array => silence;
      return {
        sampleRate: rate,
        numberOfChannels: channels,
        length,
        duration: rate === 0 ? 0 : length / rate,
        getChannelData,
        ...copiers(getChannelData),
      };
    }
  }

  return new Proxy(StubAudioContext, {
    construct: (target, args): object =>
      new Proxy(Reflect.construct(target, args) as object, {
        get(instance, property): unknown {
          const value = Reflect.get(instance, property) as unknown;
          if (value !== undefined) {
            return typeof value === "function"
              ? (value as (...a: unknown[]) => unknown).bind(instance)
              : value;
          }
          if (typeof property !== "string" || property === "then") {
            return undefined;
          }
          return (): unknown => inertAudioNode();
        },
      }),
  });
}

/** The one stand-in context a worker installed, and everyone still holding it. */
let standingContext: {
  readonly restore: () => void;
  readonly decode: AudioHostOptions["decode"];
  readonly sampleRate: number;
  users: number;
} | null = null;

/**
 * Give this process an `AudioContext` that decodes and never sounds.
 *
 * Returns the function that gives up ONE hold on it. The global goes back to the
 * descriptor that was found — which on a bare Node process means being deleted —
 * only when the last hold is given up, and each returned function is idempotent,
 * so calling one twice gives up one hold.
 *
 * REFERENCE COUNTED FOR THE REASON `./assets` IS. Two harnesses in one worker both
 * install: the second joins the first's context rather than standing up a second,
 * and the first harness's teardown must not pull the context out from under the
 * second. Both are decoding through the FIRST caller's `decode`, which is correct
 * for two harnesses of one project — their options come from one config object —
 * and is why nothing here tries to reconcile two.
 *
 * INSTALLED ONLY WHERE THE HOST HAS NONE, unless {@link AudioHostOptions.replace}
 * says otherwise. Where a real Web Audio is present this installs nothing and
 * answers a teardown that does nothing, so a host that really can decode keeps
 * the decoder that really can.
 */
export function installAudioContext(options: AudioHostOptions): () => void {
  const sampleRate = options.sampleRate ?? 48000;

  if (standingContext !== null) {
    const held = standingContext;
    // A SECOND INSTALL THAT DISAGREES THROWS, for the reason `./assets`' does and
    // with a worse failure to prevent: a harness that asked for `wavAudioBuffer`
    // and joined a context decoding through `silentAudioBuffer` would read
    // SILENCE off every channel, with nothing to tell it so — a check about what
    // a cue holds would flip on a fact about which harness installed first.
    if (held.decode !== options.decode) {
      throw new Error(
        "case-harness: an AudioContext is already installed in this worker with " +
          "a different `decode`; two projects in one worker must agree about " +
          "whether a cue's samples are decoded",
      );
    }
    if (held.sampleRate !== sampleRate) {
      throw new Error(
        `case-harness: an AudioContext is already installed in this worker with ` +
          `sampleRate ${String(held.sampleRate)}; this call asks for ${String(sampleRate)}`,
      );
    }
    held.users += 1;
    let spent = false;
    return () => {
      if (spent) return;
      spent = true;
      if (standingContext !== held) return;
      held.users -= 1;
      if (held.users === 0) {
        standingContext = null;
        held.restore();
      }
    };
  }

  const bag = globalThis as unknown as Record<string, unknown>;
  const had = Object.getOwnPropertyDescriptor(bag, "AudioContext");
  if (had !== undefined && options.replace !== true) return () => {};

  Object.defineProperty(bag, "AudioContext", {
    value: createAudioContextStub({ ...options, sampleRate }),
    writable: true,
    enumerable: true,
    configurable: true,
  });

  const installed = {
    restore: () => {
      if (had === undefined) delete bag.AudioContext;
      else Object.defineProperty(bag, "AudioContext", had);
    },
    decode: options.decode,
    sampleRate,
    users: 1,
  };
  standingContext = installed;

  let spent = false;
  return () => {
    if (spent) return;
    spent = true;
    if (standingContext !== installed) return;
    installed.users -= 1;
    if (installed.users === 0) {
      standingContext = null;
      installed.restore();
    }
  };
}
