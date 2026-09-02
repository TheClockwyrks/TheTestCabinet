/**
 * WebCodecs, stood in for.
 *
 * The recorder encodes the frames the pipeline drew with the browser's
 * `VideoEncoder`, wrapping each composed frame — the stage canvas with the screen
 * layer over it — in a `VideoFrame` and writing the chunks it emits into a WebM
 * container. Neither class exists here: Node supplies
 * no WebCodecs, and jsdom implements none of it either, so a recorder suite that
 * did not stand them in could not run at all — the first `new VideoEncoder(...)`
 * would throw a `ReferenceError`.
 *
 * The stubs below are the whole of what the recorder meets. They are deliberately
 * not a VP9 encoder: what a recorder test can honestly claim is that the right
 * frames were handed over, in the right order, with the right timestamps, that
 * every frame was closed, and that the bytes the container holds are the bytes the
 * encoder emitted. A real encoding is checked in a browser by a case's validators,
 * where the evidence is a video that plays.
 *
 * The encoder is asynchronous the way a real one is: `encode` queues, chunks reach
 * the `output` callback on a later microtask, and `flush` resolves only once the
 * last of them has. That ordering is the property the recorder's `stopRecording`
 * depends on, so a stub that emitted synchronously would let a bug through.
 */

/* -------------------------------------------------------------------------- */
/* Chunks and frames                                                          */
/* -------------------------------------------------------------------------- */

/** A chunk, shaped as `EncodedVideoChunk` is where the recorder reads it. */
export interface FakeEncodedVideoChunk {
  /** Whether the chunk decodes on its own or from the keyframe before it. */
  readonly type: "key" | "delta";
  /** The presentation timestamp in microseconds, as the encoder was given it. */
  readonly timestamp: number;
  /** How long the frame is shown, in microseconds, where the caller said. */
  readonly duration?: number;
  /** How many bytes `copyTo` writes. */
  readonly byteLength: number;
  /** Writes the chunk's bytes into `destination`. */
  copyTo(destination: ArrayBufferView): void;
}

/** How a caller sized and timed a `VideoFrame`. */
export interface FakeVideoFrameInit {
  timestamp: number;
  duration?: number;
  displayWidth?: number;
  displayHeight?: number;
}

/**
 * A `VideoFrame`, holding the source it was made from rather than its pixels.
 *
 * The source matters and the pixels do not: what a recorder test asks is *which*
 * canvas was handed over for a given engine frame, and whether the frame was closed
 * afterwards. A real `VideoFrame` holds a GPU or system-memory buffer that leaks
 * until `close`, so `closed` here is the assertion that keeps that honest.
 */
export class FakeVideoFrame {
  /** Whether `close` has been called. */
  closed = false;
  readonly timestamp: number;
  readonly duration: number | undefined;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;

  constructor(
    /** The canvas, image, or buffer the frame was made from. */
    readonly source: unknown,
    init: FakeVideoFrameInit,
  ) {
    const sized = source as { width?: number; height?: number };
    this.timestamp = init.timestamp;
    this.duration = init.duration;
    this.codedWidth = sized.width ?? 0;
    this.codedHeight = sized.height ?? 0;
    this.displayWidth = init.displayWidth ?? this.codedWidth;
    this.displayHeight = init.displayHeight ?? this.codedHeight;
  }

  close(): void {
    this.closed = true;
  }
}

/* -------------------------------------------------------------------------- */
/* The encoder                                                                */
/* -------------------------------------------------------------------------- */

/** The callbacks a `VideoEncoder` is constructed with. */
export interface FakeVideoEncoderInit {
  output: (chunk: FakeEncodedVideoChunk, metadata?: unknown) => void;
  error: (error: DOMException | Error) => void;
}

/** What a caller asked `encode` for on one frame. */
export interface FakeEncodeOptions {
  keyFrame?: boolean;
}

/** How the fake encoder should behave, for a test that wants something particular. */
export interface FakeEncoderBehaviour {
  /**
   * How many frames apart the encoder emits a keyframe of its own accord. The first
   * frame after a `configure` is always a keyframe, as a real encoder's is.
   * Defaults to 60.
   */
  keyframeInterval?: number;
  /**
   * How many bytes a chunk carries. A function is passed the frame's index, so a
   * test can make a keyframe cost more than the frames after it. Defaults to 128.
   */
  chunkBytes?: number | ((index: number, type: "key" | "delta") => number);
  /**
   * Holds every chunk until {@link FakeVideoEncoder.drain} or `flush` releases it,
   * rather than letting it reach `output` on the next microtask. This is how a test
   * arranges for chunks to still be in flight when `stopRecording` is called.
   */
  manual?: boolean;
  /**
   * The frame index whose `encode` reports a failure through the `error` callback
   * instead of emitting a chunk, for the error path.
   */
  errorOn?: number;
}

/**
 * A `VideoEncoder` that accounts for what it was given and emits a chunk per frame.
 *
 * The chunk's bytes are synthetic but not arbitrary: every byte of the chunk for
 * frame *n* is `n % 251`, so a container assembled out of several chunks can be
 * taken apart again and each region attributed to the frame it came from. A stub
 * that emitted zeroes could not tell a container that wrote its chunks in order
 * from one that wrote the same chunk twice.
 */
export class FakeVideoEncoder {
  /** Mirrors the real `state`: nothing may be encoded before a `configure`. */
  state: "unconfigured" | "configured" | "closed" = "unconfigured";
  /** The configurations this encoder was given, oldest first. */
  readonly configs: unknown[] = [];
  /** Every frame handed to `encode`, with the options it came with. */
  readonly encoded: { frame: FakeVideoFrame; options?: FakeEncodeOptions }[] =
    [];
  /** Every chunk that reached the `output` callback, oldest first. */
  readonly emitted: FakeEncodedVideoChunk[] = [];
  /** How many times `flush` was called, and how many times `close`. */
  flushes = 0;
  closes = 0;

  /** Chunks built but not yet delivered. */
  private pending: FakeEncodedVideoChunk[] = [];
  /** Whether a microtask is already scheduled to deliver them. */
  private draining = false;
  private index = 0;

  constructor(
    private readonly init: FakeVideoEncoderInit,
    private readonly behaviour: FakeEncoderBehaviour = {},
  ) {}

  /** How many frames are queued but not yet emitted, as the real property reports. */
  get encodeQueueSize(): number {
    return this.pending.length;
  }

  static isConfigSupported(
    config: unknown,
  ): Promise<{ supported: boolean; config: unknown }> {
    return Promise.resolve({ supported: true, config });
  }

  configure(config: unknown): void {
    this.configs.push(config);
    this.state = "configured";
  }

  encode(frame: FakeVideoFrame, options?: FakeEncodeOptions): void {
    if (this.state !== "configured") {
      throw new Error(
        `the encoder was asked to encode while ${this.state}, which a real VideoEncoder refuses`,
      );
    }
    const index = this.index++;
    this.encoded.push(options === undefined ? { frame } : { frame, options });

    if (this.behaviour.errorOn === index) {
      this.init.error(
        new Error(`the encoder failed on frame ${String(index)}`),
      );
      return;
    }

    const interval = this.behaviour.keyframeInterval ?? 60;
    const type: "key" | "delta" =
      options?.keyFrame === true || index % interval === 0 ? "key" : "delta";
    this.pending.push(chunk(index, type, frame, this.behaviour.chunkBytes));
    if (this.behaviour.manual !== true) this.schedule();
  }

  /**
   * Delivers every chunk built so far.
   *
   * A test with `manual` behaviour calls this to say when the encoder caught up,
   * which is how the window between an `encode` and its chunk is opened wide enough
   * to assert something inside it.
   */
  drain(): void {
    const due = this.pending;
    this.pending = [];
    for (const one of due) {
      this.emitted.push(one);
      this.init.output(one);
    }
  }

  /** Delivers everything outstanding and resolves after the last chunk, as the real one does. */
  async flush(): Promise<void> {
    this.flushes += 1;
    this.drain();
    // A real flush settles a task later than the last output callback. Awaiting a
    // resolved promise reproduces that ordering, so a caller that awaits the flush
    // is guaranteed to run after every `output` the flush released.
    await Promise.resolve();
  }

  close(): void {
    this.closes += 1;
    this.state = "closed";
    this.pending = [];
  }

  /** Discards what is queued and returns the encoder to `unconfigured`. */
  reset(): void {
    this.pending = [];
    this.index = 0;
    this.state = "unconfigured";
  }

  private schedule(): void {
    if (this.draining) return;
    this.draining = true;
    void Promise.resolve().then(() => {
      this.draining = false;
      this.drain();
    });
  }
}

/** Builds one chunk, with bytes that name the frame they came from. */
function chunk(
  index: number,
  type: "key" | "delta",
  frame: FakeVideoFrame,
  bytes: FakeEncoderBehaviour["chunkBytes"],
): FakeEncodedVideoChunk {
  const byteLength =
    typeof bytes === "function" ? bytes(index, type) : (bytes ?? 128);
  const payload = new Uint8Array(byteLength).fill(index % 251);
  return {
    type,
    timestamp: frame.timestamp,
    ...(frame.duration === undefined ? {} : { duration: frame.duration }),
    byteLength,
    copyTo(destination: ArrayBufferView): void {
      new Uint8Array(
        destination.buffer,
        destination.byteOffset,
        destination.byteLength,
      ).set(payload.subarray(0, destination.byteLength));
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Installing and taking away                                                 */
/* -------------------------------------------------------------------------- */

/** The handle {@link installCodecs} hands back. */
export interface InstalledCodecs {
  /** Every encoder the code under test constructed, oldest first. */
  readonly encoders: readonly FakeVideoEncoder[];
  /** Every frame it constructed, oldest first — so a test can prove each was closed. */
  readonly frames: readonly FakeVideoFrame[];
  /** The most recently constructed encoder, which is the one a single recording used. */
  encoder(): FakeVideoEncoder | undefined;
  /** Puts the globals back the way they were, whether they existed or not. */
  uninstall(): void;
}

/**
 * Puts `VideoEncoder` and `VideoFrame` on the global object for the length of a
 * test, and records everything constructed through them.
 *
 * The globals are restored rather than deleted, so a host that does supply WebCodecs
 * is left as it was and the suite behaves the same whether or not it ran there.
 */
export function installCodecs(
  behaviour: FakeEncoderBehaviour = {},
): InstalledCodecs {
  const encoders: FakeVideoEncoder[] = [];
  const frames: FakeVideoFrame[] = [];
  const global = globalThis as Record<string, unknown>;
  const hadEncoder = "VideoEncoder" in global;
  const hadFrame = "VideoFrame" in global;
  const previousEncoder = global["VideoEncoder"];
  const previousFrame = global["VideoFrame"];

  class TrackedVideoEncoder extends FakeVideoEncoder {
    constructor(init: FakeVideoEncoderInit) {
      super(init, behaviour);
      encoders.push(this);
    }
  }
  class TrackedVideoFrame extends FakeVideoFrame {
    constructor(source: unknown, init: FakeVideoFrameInit) {
      super(source, init);
      frames.push(this);
    }
  }

  global["VideoEncoder"] = TrackedVideoEncoder;
  global["VideoFrame"] = TrackedVideoFrame;

  return {
    encoders,
    frames,
    encoder: () => encoders.at(-1),
    uninstall: () => {
      if (hadEncoder) global["VideoEncoder"] = previousEncoder;
      else delete global["VideoEncoder"];
      if (hadFrame) global["VideoFrame"] = previousFrame;
      else delete global["VideoFrame"];
    },
  };
}

/** Whether the host itself supplies WebCodecs, as the recorder's own check asks. */
export function hasCodecs(): boolean {
  return "VideoEncoder" in globalThis;
}
