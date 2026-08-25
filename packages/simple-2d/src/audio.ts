/**
 * The engine's audio bus: named cues, played or looped by name, announced as
 * events.
 *
 * The engine owns sound rather than handing the game a Web Audio context, because
 * a produced 2D game needs a handful of bleeps and should not have to relearn
 * oscillators, gain envelopes and the autoplay policy to get them. A game declares
 * a cue once and plays it by name; everything below that name — the graph, the
 * unlock, the mute — belongs here.
 *
 * A cue is either synthesized from a {@link CueSpec} or backed by a produced audio
 * file, and the two share one namespace. Swapping a placeholder bleep for a
 * generated clip is therefore a change to the declaration alone: every play site
 * names the cue and reads the same either way.
 *
 * A cue is played once or looped. A play ends on its own; a loop sounds until the
 * game stops it, which is what an engine hum, a held thruster or a music bed
 * needs. A loop is a fact about the cue name — it is looping or it is not — so
 * starting one that already runs and stopping one that does not are both no-ops,
 * and a game can drive a loop from its state on every frame without counting
 * starts against stops.
 *
 * Playing is *observed* rather than recorded. A driver cannot listen to a headless
 * browser, so "did the build make a noise when the ball bounced" has to be
 * answerable from outside — but an engine-owned log would have to keep every cue
 * of every run against the chance that something reads it, and that grows for as
 * long as the game plays. Each play instead publishes `cue:played` synchronously,
 * inside the call, so a subscriber runs while the frame that played the cue is
 * still running and keeps exactly the shape of record it wants. A loop is
 * announced the same way, once at each transition: `cue:looped` when it starts
 * and `cue:stopped` when it ends. Nothing in this file grows with the number of
 * plays: what is retained is one entry per declared cue name, which the game fixes
 * during its initialization, and one per running loop, which is bounded by the
 * first.
 *
 * Two further consequences shape the file:
 *
 * - A cue is announced whether or not anything is audible — muted, still locked,
 *   or running with no audio support at all. Audibility is a property of the
 *   environment; the game reacting to an event is a property of the build, and
 *   only the second is what a driver is trying to establish. Mute is expressed as
 *   a gain of zero rather than as a missing event, which keeps a game that reacted
 *   while muted distinguishable from one that never reacted.
 * - Nothing about audio is allowed to fail a frame. A browser that refuses us a
 *   context, or one whose context dies mid-frame, degrades the bus to one that
 *   accepts cues, announces them, and sounds nothing.
 *
 * The one thing that *does* throw is playing, looping or stopping a cue that was
 * never declared: that is a typo in the build, silence is the expected outcome of
 * a muted or still locked bus, so the mistake would otherwise be indistinguishable
 * from a cue that played inaudibly and would survive to the end of the run
 * unnoticed.
 */

import type { AudioState, CueSpec, EngineEventMap } from "./contract";

/** The peak gain a synthesized cue plays at when its spec does not name one. */
const DEFAULT_CUE_GAIN = 0.2;

/**
 * The gain a file-backed cue is announced at, and the level it sounds at.
 *
 * A produced clip carries its own level — that is the asset's business, decided
 * when it was generated — so the bus plays the buffer as it arrived rather than
 * scaling it, and reports the unity gain that describes what it did.
 */
const FILE_CUE_GAIN = 1;

/**
 * The floor an exponential gain ramp decays to. `exponentialRampToValueAtTime`
 * cannot reach zero, so the envelope lands on an inaudible value instead and the
 * oscillator is stopped there.
 */
const SILENCE_GAIN = 0.0001;

/** The four events the bus publishes. It publishes no others. */
type AudioEventName =
  | "audio:unlocked"
  | "cue:played"
  | "cue:looped"
  | "cue:stopped";

/**
 * How the bus announces a cue and the unlock.
 *
 * A plain function rather than an event-bus object, for the same reason the
 * asset loader takes one: the bus needs to *say* things, not to be
 * subscribed to, and taking the narrowest thing that does the job keeps this
 * module a leaf a test can drive with a two-line spy.
 */
export type CueEventEmitter = <K extends AudioEventName>(
  event: K,
  payload: EngineEventMap[K],
) => void;

/**
 * What a declared cue plays.
 *
 * The two kinds are one union rather than two maps so that a name carries exactly
 * one source: redeclaring it replaces whatever was there, whichever kind declared
 * it, and {@link AudioBus.play} has one place to look for a name it was given.
 */
type Cue =
  | { readonly kind: "synth"; readonly spec: CueSpec }
  | { readonly kind: "file"; readonly buffer: AudioBuffer };

/**
 * The nodes a running loop sounds through: its source, and the gain node the
 * mute drives.
 *
 * Every loop gets its own gain node, a file-backed one included, because the mute
 * has to reach a loop that is already sounding. A one-shot play is short enough
 * that muting it mid-flight would be pointless; a loop is by definition still
 * running when the mute arrives, and the gain node is the handle that silences it
 * in place and restores it without restarting.
 */
interface LoopGraph {
  readonly source: AudioScheduledSourceNode;
  readonly amp: GainNode;
}

/**
 * A loop the game has started and not yet stopped.
 *
 * `graph` is `null` while the bus has no context: a loop requested before the
 * unlock is looping in every sense the game can observe — `looping` says so and
 * the event has fired — and the graph is built the moment the gesture opens the
 * context. The loop reads its cue at that moment rather than caching it, so a
 * declaration that changed in between is what sounds; a redeclaration stops the
 * loop anyway, so the two can only ever agree.
 */
interface Loop {
  graph: LoopGraph | null;
}

/** What an {@link AudioBus} is built over. Every field has a working default. */
export interface AudioBusOptions {
  /** Where the bus announces its cues; defaults to announcing nowhere. */
  emit?: CueEventEmitter;

  /**
   * The frame loop's accumulated simulated time, in milliseconds; defaults to a
   * clock that has not started.
   *
   * A cue is stamped with frame time rather than wall time so its timestamp lines
   * up with the frame counter. Frames stepped through `engine.advance` run back to
   * back and no real time passes, so wall-clock stamps would put every cue of a
   * several-hundred-frame advance at the same instant; read against the frame
   * clock, a cue's time says which frame of the simulation it belongs to.
   *
   * The default is a constant zero rather than the wall clock on purpose. An
   * engine always supplies the loop's clock, and a bus built without one is one
   * nothing is driving — a stamp of zero says so, where a plausible-looking wall
   * time would be wrong in a way that reads as right.
   */
  now?: () => number;

  /**
   * Fetches and decodes an audio file under the asset root — the asset loader's own
   * `loadAudio`. Defaults to rejecting by name.
   *
   * Routing a file-backed cue through the loader rather than fetching here is what
   * makes it obey the asset root, the path rules, and the `asset:loaded` and
   * `asset:failed` events, exactly as any other asset a build loads does.
   */
  loadAudio?: (path: string) => Promise<AudioBuffer>;

  /**
   * The context cues are played through, or `null` where the host has no Web
   * Audio; defaults to the platform's.
   *
   * Asked for lazily, inside {@link AudioBus.unlock}, rather than at construction:
   * a context created outside a user gesture starts suspended, and some browsers
   * count the attempt against the page.
   */
  audioContext?: () => AudioContext | null;
}

/**
 * Creates the browser's audio context, or `null` where there isn't one.
 *
 * A browser with no Web Audio at all and a test with no fake take the same path
 * out of here, which is why degradation needs no separate mode.
 */
function defaultContextFactory(): AudioContext | null {
  const ctor = (globalThis as { AudioContext?: typeof AudioContext })
    .AudioContext;
  return ctor ? new ctor() : null;
}

/**
 * The gain a cue is announced at and, when audible, sounds at — before mute is
 * applied.
 *
 * Read at play time rather than stored at declaration time so that redeclaring a
 * name is the only thing that changes what it plays.
 */
function nominalGain(cue: Cue): number {
  return cue.kind === "synth"
    ? (cue.spec.gain ?? DEFAULT_CUE_GAIN)
    : FILE_CUE_GAIN;
}

/**
 * The message for a name nothing declared. One place, so `play`, `loop` and
 * `stop` complain identically and a build's author reads the same fix each time.
 */
function undeclared(cue: string, verb: string): Error {
  return new Error(
    `unknown audio cue "${cue}" — declare it with audio.define("${cue}", spec) or audio.load("${cue}", path) before ${verb} it`,
  );
}

/** The engine's audio bus. */
export class AudioBus {
  private readonly emit: CueEventEmitter;
  private readonly now: () => number;
  private readonly decode: (path: string) => Promise<AudioBuffer>;
  private readonly factory: () => AudioContext | null;
  private readonly cues = new Map<string, Cue>();
  private readonly loops = new Map<string, Loop>();
  private context: AudioContext | null = null;
  private isMuted = false;
  private isUnlocked = false;

  constructor(options: AudioBusOptions = {}) {
    this.emit = options.emit ?? ((): void => {});
    this.now = options.now ?? ((): number => 0);
    this.decode =
      options.loadAudio ??
      ((path: string): Promise<AudioBuffer> =>
        Promise.reject(
          new Error(
            `audio "${path}" cannot be loaded: this bus was built with no asset loader`,
          ),
        ));
    this.factory = options.audioContext ?? defaultContextFactory;
  }

  /**
   * Declares a synthesized cue under a name.
   *
   * Declaring a name that already holds a cue replaces it, of either kind, which
   * is what lets a sound be retuned without tearing the bus down. A loop running
   * under the name is stopped, and announced as stopped, because it was sounding
   * the cue that has just ceased to exist.
   */
  define(cue: string, spec: CueSpec): void {
    this.stopLoop(cue);
    this.cues.set(cue, { kind: "synth", spec });
  }

  /**
   * Backs a cue with a produced audio file, resolved under the asset root and
   * decoded through the asset loader. Resolves once the cue is playable.
   *
   * The name is bound only after the decode has succeeded, so a load that was
   * refused, that never arrived, or that could not be decoded leaves the name
   * exactly as it was — undeclared if it was undeclared, and still holding its
   * previous cue if it held one. The rejection carries the loader's cause
   * unchanged, and the loader has already announced the failure. A loop running
   * under the name is likewise stopped only at the rebind, so a failed load
   * leaves it sounding what it was.
   */
  async load(cue: string, path: string): Promise<void> {
    const buffer = await this.decode(path);
    this.stopLoop(cue);
    this.cues.set(cue, { kind: "file", buffer });
  }

  /**
   * Plays a declared cue: announces it, then sounds it if anything can be heard.
   *
   * Throws if the cue was never declared. Silence is the expected outcome of a
   * muted or still-locked bus, so a typo'd name would otherwise disappear into the
   * same silence and never be noticed.
   */
  play(cue: string): void {
    const declared = this.cues.get(cue);
    if (!declared) throw undeclared(cue, "playing");

    // Mute is a gain of zero in the event rather than a missing event, so a driver
    // can still establish that the build reacted and can tell a muted game apart
    // from an unresponsive one.
    const gain = this.isMuted ? 0 : nominalGain(declared);
    this.emit("cue:played", { cue, t: this.now(), gain });

    // Below this line is audibility alone. No context yet (still locked, or no
    // audio support at all), or nothing to hear anyway, and the event is the whole
    // of what the play did.
    if (!this.context || gain <= 0) return;
    if (declared.kind === "synth") this.synthesize(declared.spec, gain);
    else this.sample(declared.buffer);
  }

  /**
   * Starts a declared cue looping: records it, announces it, then sounds it if
   * anything can be heard. A cue already looping is left exactly as it is, and
   * nothing is announced.
   *
   * The loop is recorded before it is announced so that a handler asking
   * `looping(cue)` from inside the event already reads `true`. Throws for a cue
   * that was never declared, for the same reason `play` does.
   */
  loop(cue: string): void {
    const declared = this.cues.get(cue);
    if (!declared) throw undeclared(cue, "looping");
    if (this.loops.has(cue)) return;

    const running: Loop = { graph: null };
    this.loops.set(cue, running);
    this.emit("cue:looped", {
      cue,
      t: this.now(),
      gain: this.isMuted ? 0 : nominalGain(declared),
    });

    // Without a context the loop is remembered and started from `unlock`. The
    // graph is built at the nominal gain even while muted, because the mute is
    // live: it is applied to the gain node, and lifted from it, rather than
    // deciding whether the graph exists.
    if (this.context) running.graph = this.build(declared);
  }

  /**
   * Stops a looping cue and announces the stop. A cue that is not looping is left
   * alone and nothing is announced, so a game can call this on every frame it
   * wants silence without first asking.
   *
   * Throws for a cue that was never declared: a stop aimed at a typo'd name is as
   * much a mistake as a play aimed at one, and would otherwise pass in silence.
   */
  stop(cue: string): void {
    if (!this.cues.has(cue)) throw undeclared(cue, "stopping");
    this.stopLoop(cue);
  }

  /** Whether the cue is looping. `false` for a cue that was never declared. */
  looping(cue: string): boolean {
    return this.loops.has(cue);
  }

  /**
   * Mutes or unmutes the bus. A muted cue still plays — at gain zero — and every
   * running loop follows the bit live, silenced or restored in place.
   *
   * A loop is neither stopped nor restarted by the mute: its source keeps running
   * and only its gain node moves, so unmuting resumes a music bed where it is
   * rather than from its first bar, and `looping` reads the same either way.
   */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    for (const [cue, running] of this.loops) {
      const declared = this.cues.get(cue);
      if (!running.graph || !declared) continue;
      this.setLoopGain(running.graph, muted ? 0 : nominalGain(declared));
    }
  }

  /** Whether the bus is muted. */
  muted(): boolean {
    return this.isMuted;
  }

  /** The bus's observable state: whether it is muted, and whether it is unlocked. */
  state(): AudioState {
    return { muted: this.isMuted, unlocked: this.isUnlocked };
  }

  /**
   * Opens the audio context and announces the gesture. Must be called from a real
   * user gesture, since browsers refuse to start audio outside one.
   *
   * Idempotent: repeated gestures — every click of a game's first screen — must
   * neither pile up contexts nor repeat the event. `unlocked` records that the
   * gesture happened even when no context could be created, because the gesture is
   * the bit a caller is missing when it sees a silent build; whether the browser
   * then had audio to offer is a separate question, and keeping the two apart is
   * what makes a muted build (behaving as asked) distinguishable from a locked one
   * (an environment nothing has clicked yet).
   *
   * Every loop requested before this moment starts sounding here. Its event has
   * already fired, so nothing is announced again: the game asked for the loop
   * then, and the unlock is only the environment catching up.
   */
  unlock(): void {
    if (this.isUnlocked) return;
    this.isUnlocked = true;

    try {
      this.context = this.factory();
      // A context created inside a gesture usually starts running, but one carried
      // over from a suspended page does not; resuming is cheap and covers both.
      this.context?.resume().catch(() => undefined);
    } catch {
      // A browser that refuses us a context is one the game runs in silently, not
      // one it fails to run in. The context assignment happens before the resume,
      // so a context that objects to being resumed is still kept.
    }

    if (this.context) {
      for (const [cue, running] of this.loops) {
        const declared = this.cues.get(cue);
        if (!running.graph && declared) running.graph = this.build(declared);
      }
    }

    this.emit("audio:unlocked", {});
  }

  /**
   * Stops every loop without announcing it. The engine calls this from its own
   * teardown, where a loop would otherwise outlive the game that started it and
   * the subscribers that would hear the announcement are about to be dropped.
   */
  silence(): void {
    for (const running of this.loops.values()) this.teardown(running);
    this.loops.clear();
  }

  /**
   * Ends a loop under a name and announces the stop, if one is running. Shared by
   * `stop` and by the two declarations, which stop the loop of a name they are
   * about to rebind.
   */
  private stopLoop(cue: string): void {
    const running = this.loops.get(cue);
    if (!running) return;
    this.loops.delete(cue);
    this.teardown(running);
    this.emit("cue:stopped", { cue, t: this.now() });
  }

  /**
   * One oscillator through one gain node: the frequency sweeps `freq → freqTo`
   * across the cue's duration while the gain decays to silence, and both nodes
   * stop when it ends.
   *
   * Deliberately the smallest graph that produces a recognisable bleep. Richer
   * timbre is out of scope; what matters is that the cue is heard at all and that
   * the event says it happened.
   */
  private synthesize(spec: CueSpec, gain: number): void {
    const ctx = this.context;
    if (!ctx) return;

    try {
      const start = ctx.currentTime;
      const end = start + Math.max(spec.durationMs, 0) / 1000;

      const osc = ctx.createOscillator();
      osc.type = spec.wave ?? "sine";
      osc.frequency.setValueAtTime(spec.freq, start);
      osc.frequency.linearRampToValueAtTime(spec.freqTo ?? spec.freq, end);

      const amp = ctx.createGain();
      amp.gain.setValueAtTime(gain, start);
      amp.gain.exponentialRampToValueAtTime(SILENCE_GAIN, end);

      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start(start);
      osc.stop(end);
    } catch {
      // A context that has been closed, or a browser that throws from somewhere
      // inside the graph, must not take the frame down with it. The cue has already
      // been announced; the game carries on without the sound.
    }
  }

  /**
   * Plays a decoded buffer straight through to the destination.
   *
   * No envelope and no gain node: the produced file already carries its own level
   * and its own shape, and the bus's job is to play it as generated rather than to
   * re-mix it. The node is disposable — one buffer source per play is what Web
   * Audio requires — and the browser collects it when it ends.
   */
  private sample(buffer: AudioBuffer): void {
    const ctx = this.context;
    if (!ctx) return;

    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
    } catch {
      // Same bargain as synthesis: a dead context costs the sound, never the frame.
    }
  }

  /**
   * Builds the graph a loop sounds through, or `null` when the context refuses.
   *
   * A synthesized loop is the bleep's oscillator with the envelope left out: the
   * wave holds at `freq` and the gain holds at its peak, with no sweep, no decay
   * and no stop scheduled. A file-backed loop is the buffer source with `loop` set,
   * which Web Audio wraps sample-accurately, so a produced music bed joins its own
   * tail without a gap. Both run through a gain node, which is what the live mute
   * drives.
   *
   * A `null` graph is a loop the game still owns — `looping` reads `true` and the
   * stop is still announced — that merely cannot be heard, which is the same
   * bargain a one-shot play makes with a dead context.
   */
  private build(cue: Cue): LoopGraph | null {
    const ctx = this.context;
    if (!ctx) return null;

    try {
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(
        this.isMuted ? 0 : nominalGain(cue),
        ctx.currentTime,
      );

      let source: AudioScheduledSourceNode;
      if (cue.kind === "synth") {
        const osc = ctx.createOscillator();
        osc.type = cue.spec.wave ?? "sine";
        osc.frequency.setValueAtTime(cue.spec.freq, ctx.currentTime);
        source = osc;
      } else {
        const sampler = ctx.createBufferSource();
        sampler.buffer = cue.buffer;
        sampler.loop = true;
        source = sampler;
      }

      source.connect(amp);
      amp.connect(ctx.destination);
      source.start();
      return { source, amp };
    } catch {
      // Same bargain as a one-shot: a dead context costs the sound, never the
      // frame, and never the loop's bookkeeping.
      return null;
    }
  }

  /** Moves a running loop's gain node, which is how the live mute reaches it. */
  private setLoopGain(graph: LoopGraph, gain: number): void {
    try {
      graph.amp.gain.setValueAtTime(gain, this.context?.currentTime ?? 0);
    } catch {
      // A context that died under a running loop has already silenced it; the mute
      // bit is still recorded, and the next loop to start reads it.
    }
  }

  /**
   * Stops a loop's nodes and detaches them from the destination, so the browser
   * can collect them. A loop with no graph has nothing to tear down.
   */
  private teardown(running: Loop): void {
    const graph = running.graph;
    running.graph = null;
    if (!graph) return;

    try {
      graph.source.stop();
      graph.source.disconnect();
      graph.amp.disconnect();
    } catch {
      // A source that already stopped, or a context that closed under it, throws
      // here; either way the loop is gone, which is what was asked for.
    }
  }
}
