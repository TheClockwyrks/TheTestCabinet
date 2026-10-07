// The audio bus: the produced sounds, the cues they play on, and mute.
//
// `specs/ui.md` names eleven cues and the events that raise them, with `motor`
// the one loop, and `specs/assets.md` says how they reach here: a committed
// `.wav` per cue plus the music bed, handed over as encoded bytes for this bus
// to decode with the Web Audio API. Sound does not start before the player's
// first interaction with the page, and `mute` silences the whole bus from any
// screen with the game staying fully playable.
//
// The policy — what is held until the bus opens, which sounds loop, what mute
// does — is `AudioBus`, which is plain logic over an `AudioSink` and is tested
// in Node against a recording sink. The Web Audio half is `webAudioSink`, a
// thin adapter over an `AudioContext` and the only part that needs a browser.

import type { CueName } from "./constants";

/** The name the music bed is held under, beside the cues. */
export const MUSIC_NAME = "music";

/** Playback gains. The specification fixes no mix, so this is the build's. */
export const CUE_GAIN = 0.85;
export const MOTOR_GAIN = 0.45;
export const MUSIC_GAIN = 0.3;

/**
 * The slice of an audio engine the bus drives. One implementation wraps a real
 * `AudioContext`; a test stands in its own.
 *
 * Every call is safe on a name that failed to decode or was never handed over:
 * the bus asks, the sink does what it can.
 */
export interface AudioSink {
  /** Decode and hold every named sound. Resolves once they are all ready. */
  load(sounds: ReadonlyMap<string, ArrayBuffer>): Promise<void>;
  /** Play a sound once. */
  play(name: string, gain: number): void;
  /** Start a sound looping, or do nothing if it is already looping. */
  startLoop(name: string, gain: number): void;
  /** Stop a looping sound, or do nothing if it is not looping. */
  stopLoop(name: string): void;
  /** Silence or unsilence everything the sink is playing. */
  setMuted(muted: boolean): void;
}

/**
 * The game's sound, as the runtime layer offers it.
 *
 * The bus is opened by the player's first interaction with the page, so
 * `unlock` is called from the first key press or pointer press to arrive and
 * from nowhere else. Until then the produced bytes are simply held: a cue
 * raised before the bus opens is dropped rather than queued, because a sound
 * that arrives late is worse than one that never played.
 *
 * The music bed plays under every screen, which `specs/ui.md` allows: it
 * requires the bed under `title` and `select` and leaves the rest to the build,
 * so the bus needs to know nothing about screens.
 */
export class AudioBus {
  private readonly open: () => AudioSink | null;
  private sink: AudioSink | null = null;
  private sounds: ReadonlyMap<string, ArrayBuffer> | null = null;
  private ready = false;
  private muted = false;
  private motorOn = false;

  constructor(open: () => AudioSink | null) {
    this.open = open;
  }

  /**
   * Take the produced sounds. Loading starts at once if the bus is already
   * open, and otherwise waits for it to be.
   */
  installAudio(
    cues: Readonly<Record<CueName, ArrayBuffer>>,
    music: ArrayBuffer,
  ): void {
    const sounds = new Map<string, ArrayBuffer>(Object.entries(cues));
    sounds.set(MUSIC_NAME, music);
    this.sounds = sounds;
    this.ready = false;
    if (this.sink !== null) this.beginLoad(this.sink);
  }

  /**
   * The player's first interaction with the page. Opening an `AudioContext`
   * inside that gesture is what lets it start at all, so this is called
   * synchronously from the act that carries it.
   */
  unlock(): void {
    if (this.sink !== null) return;
    const sink = this.open();
    if (sink === null) return;
    this.sink = sink;
    sink.setMuted(this.muted);
    if (this.sounds !== null) this.beginLoad(sink);
  }

  /** Whether the bus has opened and its sounds are decoded. */
  get playable(): boolean {
    return this.ready;
  }

  /** Play a one-shot cue. `motor` is the loop and is run by `setMotor`. */
  playCue(cue: CueName): void {
    if (cue === "motor") return;
    if (!this.ready || this.sink === null) return;
    this.sink.play(cue, CUE_GAIN);
  }

  /**
   * Start or stop the one loop. Calling it with what is already so does
   * nothing, so a frame may set it every update.
   */
  setMotor(on: boolean): void {
    if (on === this.motorOn) return;
    this.motorOn = on;
    if (!this.ready || this.sink === null) return;
    if (on) this.sink.startLoop("motor", MOTOR_GAIN);
    else this.sink.stopLoop("motor");
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Toggle all sound. Mute silences the bus rather than stopping it, so the
   * loops the game is running are where it left them when it comes back.
   */
  toggleMute(): void {
    this.muted = !this.muted;
    this.sink?.setMuted(this.muted);
  }

  private beginLoad(sink: AudioSink): void {
    const sounds = this.sounds;
    if (sounds === null) return;
    sink
      .load(sounds)
      .then(() => {
        if (this.sink !== sink) return;
        this.ready = true;
        sink.startLoop(MUSIC_NAME, MUSIC_GAIN);
        if (this.motorOn) sink.startLoop("motor", MOTOR_GAIN);
      })
      .catch(() => {
        // A sound that will not decode costs the game nothing else: the yard
        // stays playable in silence.
      });
  }
}

/**
 * Open a bus over the Web Audio API, or answer `null` where there is none.
 *
 * Called from inside the gesture that unlocks the page's audio, so the context
 * is created — and resumed — while that gesture is still on the stack.
 */
export function webAudioSink(): AudioSink | null {
  if (typeof AudioContext === "undefined") return null;
  return audioSinkOver(new AudioContext());
}

/** The same bus over a context already in hand. */
export function audioSinkOver(context: AudioContext): AudioSink {
  return new WebAudioSink(context);
}

/** The Web Audio half: a master gain, decoded buffers, and the live loops. */
class WebAudioSink implements AudioSink {
  private readonly context: AudioContext;
  private readonly master: GainNode;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loops = new Map<string, AudioBufferSourceNode>();

  constructor(context: AudioContext) {
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 1;
    this.master.connect(context.destination);
    this.resume();
  }

  async load(sounds: ReadonlyMap<string, ArrayBuffer>): Promise<void> {
    this.resume();
    const entries = [...sounds];
    const decoded = await Promise.all(
      // `decodeAudioData` takes the buffer over, so each is decoded from a
      // copy and the bytes stay usable.
      entries.map(([, bytes]) => this.context.decodeAudioData(bytes.slice(0))),
    );
    entries.forEach(([name], i) => {
      const buffer = decoded[i];
      if (buffer !== undefined) this.buffers.set(name, buffer);
    });
  }

  play(name: string, gain: number): void {
    const source = this.source(name, gain);
    if (source === null) return;
    source.node.start();
  }

  startLoop(name: string, gain: number): void {
    if (this.loops.has(name)) return;
    const source = this.source(name, gain);
    if (source === null) return;
    source.node.loop = true;
    source.node.start();
    this.loops.set(name, source.node);
  }

  stopLoop(name: string): void {
    const node = this.loops.get(name);
    if (node === undefined) return;
    this.loops.delete(name);
    node.stop();
  }

  setMuted(muted: boolean): void {
    this.master.gain.value = muted ? 0 : 1;
    if (!muted) this.resume();
  }

  /** One voice: a buffer source through its own gain into the master. */
  private source(
    name: string,
    gain: number,
  ): { node: AudioBufferSourceNode } | null {
    const buffer = this.buffers.get(name);
    if (buffer === undefined) return null;
    const level = this.context.createGain();
    level.gain.value = gain;
    level.connect(this.master);
    const node = this.context.createBufferSource();
    node.buffer = buffer;
    node.connect(level);
    node.onended = () => {
      node.disconnect();
      level.disconnect();
    };
    return { node };
  }

  private resume(): void {
    this.context.resume().catch(() => {
      // The gesture that opens the page's audio may not have arrived yet; the
      // next one resumes it.
    });
  }
}
