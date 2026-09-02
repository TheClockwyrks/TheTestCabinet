/**
 * The engine's audio bus: named cues, played or looped by name, placed in the
 * world or not, announced as events.
 *
 * The engine owns sound rather than handing the game a Web Audio context, because
 * a produced 3D game needs a handful of bleeps and a hum or two and should not
 * have to relearn oscillators, gain envelopes, panners and the autoplay policy to
 * get them. A game declares a cue once and plays it by name; everything below
 * that name — the graph, the panner, the listener, the unlock, the mute — belongs
 * here.
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
 * ## Position is a property of the playback, not of the cue
 *
 * Either kind of cue plays unpositioned or at a world point, and that choice is
 * made at the play site rather than at the declaration. A cue given a point is
 * routed through a panner standing there and is heard from where the camera
 * stands; a cue given none plays exactly as it does in the 2D engine, at the
 * bus's gain with no panning. One declared clank therefore serves both the impact
 * of a specific object and the confirmation beep that belongs to no place at all,
 * which is why `at` rides on {@link PlayOptions} instead of on {@link CueSpec}.
 *
 * The panner's model is fixed here rather than exposed: inverse distance from a
 * reference distance of one world unit, a rolloff of one, a maximum distance of
 * ten thousand, and HRTF panning. Fixing it is what makes a positioned cue read
 * the same in every build — one unit away sounds at the cue's gain and two units
 * away at half — so a game places its sounds in the units it already places its
 * objects in and tunes nothing per cue.
 *
 * A positioned one-shot keeps the point it was played at for its whole duration:
 * it is over before a move could be heard, and giving it a moving point would
 * oblige the bus to retain something per play. A positioned loop is moved with
 * {@link AudioBus.place}, which is what a motor on a travelling crane needs, and a
 * loop started with no point stays unpositioned for its life — a loop that could
 * acquire a panner halfway through would jump across the stereo field at the
 * moment it did.
 *
 * ## The listener stands at the camera
 *
 * {@link AudioBus.listen} takes the camera's pose and writes it to the context's
 * listener, and the engine calls it every frame from the same snapshot the view
 * answers from. Sound and picture therefore agree by construction: a cue at a
 * world point is heard from where it is seen to be, a loop at a fixed point
 * crosses the stereo field as the camera turns, and a game poses the ear by
 * posing the eye rather than by keeping a second pose in step with the first.
 *
 * The pose is retained so the unlock can apply it: a game that has already
 * rendered several frames when the first gesture arrives gets a listener standing
 * where its camera stands rather than at the origin until the next frame.
 *
 * ## Playing is observed rather than recorded
 *
 * A driver cannot listen to a headless browser, so "did the build make a noise
 * when the hook landed, and did it come from the hook" has to be answerable from
 * outside — but an engine-owned log would have to keep every cue of every run
 * against the chance that something reads it, and that grows for as long as the
 * game plays. Each play instead publishes `cue:played` synchronously, inside the
 * call, carrying the point it was placed at as a copy or `null`, so a subscriber
 * runs while the frame that played the cue is still running and keeps exactly the
 * shape of record it wants. A loop is announced the same way, once at each
 * transition: `cue:looped` when it starts and `cue:stopped` when it ends. Nothing
 * in this file grows with the number of plays: what is retained is one entry per
 * declared cue name, which the game fixes during its initialization, and one per
 * running loop, which is bounded by the first.
 *
 * Two further consequences shape the file:
 *
 * - A cue is announced whether or not anything is audible — muted, still locked,
 *   or running with no audio support at all. Audibility is a property of the
 *   environment; the game reacting to an event is a property of the build, and
 *   only the second is what a driver is trying to establish. Mute is expressed as
 *   a gain of zero rather than as a missing event, which keeps a game that reacted
 *   while muted distinguishable from one that never reacted. The gain announced is
 *   the gain the cue was played at, before whatever the panner then takes off for
 *   distance, so the figure describes the build's decision rather than the
 *   listener's position.
 * - Nothing about audio is allowed to fail a frame. A browser that refuses us a
 *   context, one whose context dies mid-frame, and one whose panner objects to
 *   being placed all degrade the bus to one that accepts cues, announces them, and
 *   sounds nothing.
 *
 * The one thing that *does* throw is playing, looping, stopping or placing a cue
 * that was never declared: that is a typo in the build, silence is the expected
 * outcome of a muted or still locked bus, so the mistake would otherwise be
 * indistinguishable from a cue that played inaudibly and would survive to the end
 * of the run unnoticed.
 */

import type {
  AudioState,
  CameraSnapshot,
  CueSpec,
  EngineEventMap,
  PlayOptions,
  Quat,
  Vec3,
} from "./contract";

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

/**
 * The panner every positioned cue is routed through, fixed by the engine.
 *
 * Inverse distance attenuation from a reference of one world unit with a rolloff
 * of one is the plain physical falloff — full gain at a unit away, half at two,
 * a third at three — which is what lets a build place a sound in the units it
 * places its objects in. The maximum distance is far enough that nothing in a
 * produced game reaches it, so distance never stops mattering partway across a
 * scene, and HRTF panning is what makes a sound behind the camera read as behind
 * it rather than merely quiet.
 */
const PANNER_PANNING_MODEL: PanningModelType = "HRTF";
/** @see PANNER_PANNING_MODEL */
const PANNER_DISTANCE_MODEL: DistanceModelType = "inverse";
/** @see PANNER_PANNING_MODEL */
const PANNER_REFERENCE_DISTANCE = 1;
/** @see PANNER_PANNING_MODEL */
const PANNER_ROLLOFF_FACTOR = 1;
/** @see PANNER_PANNING_MODEL */
const PANNER_MAX_DISTANCE = 10000;

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
 * Neither variant carries a position, because position belongs to the playback.
 */
type Cue =
  | { readonly kind: "synth"; readonly spec: CueSpec }
  | { readonly kind: "file"; readonly buffer: AudioBuffer };

/**
 * The two shapes a browser's listener comes in.
 *
 * The current one exposes six `AudioParam`s; the one Safari shipped for years
 * exposes `setPosition` and `setOrientation` instead. Both are declared in the
 * DOM types as always present, which is exactly what a runtime feature check
 * needs to disprove, so the bus reads the listener through this structural view
 * where every member is optional and picks whichever half the host actually has.
 */
interface ListenerTarget {
  positionX?: AudioParam;
  positionY?: AudioParam;
  positionZ?: AudioParam;
  forwardX?: AudioParam;
  forwardY?: AudioParam;
  forwardZ?: AudioParam;
  upX?: AudioParam;
  upY?: AudioParam;
  upZ?: AudioParam;
  setPosition?(x: number, y: number, z: number): void;
  setOrientation?(
    x: number,
    y: number,
    z: number,
    upX: number,
    upY: number,
    upZ: number,
  ): void;
}

/**
 * The same two shapes, for a panner. A browser old enough to want
 * `AudioListener.setPosition` wants `PannerNode.setPosition` too, and the pair is
 * read the same way.
 */
interface PannerTarget {
  positionX?: AudioParam;
  positionY?: AudioParam;
  positionZ?: AudioParam;
  setPosition?(x: number, y: number, z: number): void;
}

/**
 * Where a playback connects, and the panner standing in the way if there is one.
 *
 * The pair travels together because a loop needs both — the node to feed and the
 * panner to move later — while a one-shot needs only the first, and returning a
 * bare node would leave the loop to narrow the destination back to a panner it
 * already knew it had asked for.
 */
interface Sink {
  readonly node: AudioNode;
  readonly panner: PannerNode | null;
}

/**
 * The nodes a running loop sounds through: its source, the gain node the mute
 * drives, and the panner it stands at, if it stands anywhere.
 *
 * Every loop gets its own gain node, a file-backed one included, because the mute
 * has to reach a loop that is already sounding. A one-shot play is short enough
 * that muting it mid-flight would be pointless; a loop is by definition still
 * running when the mute arrives, and the gain node is the handle that silences it
 * in place and restores it without restarting.
 *
 * The panner is held for the same reason and moved by {@link AudioBus.place}. It
 * is `null` for an unpositioned loop, which is a loop wired exactly as the 2D
 * engine wires one.
 */
interface LoopGraph {
  readonly source: AudioScheduledSourceNode;
  readonly amp: GainNode;
  readonly panner: PannerNode | null;
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
 *
 * `at` is the loop's world point, or `null` for one started unpositioned, and it
 * is the loop's own copy: the game passes a point out of its state and may keep
 * mutating that object, and a panner following it by reference would drift with
 * the state rather than with the calls the build actually made. `place` writes a
 * fresh copy here, so a loop started before the unlock stands at the point it was
 * last moved to when its graph is finally built.
 */
interface Loop {
  graph: LoopGraph | null;
  at: Vec3 | null;
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
 * applied and before the panner takes anything off for distance.
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
 * A world point the bus owns, taken out of whatever the game handed in.
 *
 * The game's point usually comes straight out of its state and is often the very
 * object the next frame will write over. Copying at the boundary is what makes
 * the point on the event, and the point a loop stands at, the one the call
 * actually named.
 */
function copyPoint(at: Vec3): Vec3 {
  return { x: at.x, y: at.y, z: at.z };
}

/**
 * Turns a vector by a quaternion, as `v + 2q⃗ × (q⃗ × v + wv)`.
 *
 * Written out here rather than reached for through three, because the bus needs
 * exactly two rotated axes per frame and nothing else three offers: importing a
 * renderer to turn a pair of unit vectors would put a scene graph in the audio
 * module's dependency list for six multiplications.
 */
function rotate(q: Quat, x: number, y: number, z: number): Vec3 {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return {
    x: x + q.w * tx + (q.y * tz - q.z * ty),
    y: y + q.w * ty + (q.z * tx - q.x * tz),
    z: z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/**
 * Writes an `AudioParam` if the host has one, and reports whether it did.
 *
 * `setValueAtTime` rather than assigning `.value` so a write lands on the audio
 * thread's timeline at a stated moment, which is how every other gain in this
 * file is written and what keeps a placement from racing a ramp scheduled in the
 * same frame.
 */
function setParam(
  param: AudioParam | undefined,
  value: number,
  when: number,
): boolean {
  if (!param) return false;
  param.setValueAtTime(value, when);
  return true;
}

/**
 * The message for a name nothing declared. One place, so `play`, `loop`, `stop`
 * and `place` complain identically and a build's author reads the same fix each
 * time.
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
  private pose: { position: Vec3; rotation: Quat } | null = null;

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
   * `options.at` places it in the world; without one it plays unpositioned.
   *
   * Throws if the cue was never declared. Silence is the expected outcome of a
   * muted or still-locked bus, so a typo'd name would otherwise disappear into the
   * same silence and never be noticed.
   */
  play(cue: string, options?: PlayOptions): void {
    const declared = this.cues.get(cue);
    if (!declared) throw undeclared(cue, "playing");

    // Copied before the event, so the payload names the point as it stood at the
    // call and the play sounds at the point the payload names.
    const at = options?.at ? copyPoint(options.at) : null;

    // Mute is a gain of zero in the event rather than a missing event, so a driver
    // can still establish that the build reacted and can tell a muted game apart
    // from an unresponsive one.
    const gain = this.isMuted ? 0 : nominalGain(declared);
    this.emit("cue:played", { cue, t: this.now(), gain, at });

    // Below this line is audibility alone. No context yet (still locked, or no
    // audio support at all), or nothing to hear anyway, and the event is the whole
    // of what the play did.
    if (!this.context || gain <= 0) return;

    // A positioned cue that could not have its panner is left silent rather than
    // played from nowhere: an unpositioned substitute would be heard at full gain
    // in the middle of the field, which is a louder lie than saying nothing.
    const out = this.sink(at);
    if (!out) return;

    if (declared.kind === "synth")
      this.synthesize(declared.spec, gain, out.node);
    else this.sample(declared.buffer, out.node);
  }

  /**
   * Starts a declared cue looping: records it, announces it, then sounds it if
   * anything can be heard. `options.at` places the loop, and a loop started
   * without one stays unpositioned for its life. A cue already looping is left
   * exactly as it is, and nothing is announced — including a second `loop` naming
   * a different point, which is what `place` is for.
   *
   * The loop is recorded before it is announced so that a handler asking
   * `looping(cue)` from inside the event already reads `true`. Throws for a cue
   * that was never declared, for the same reason `play` does.
   */
  loop(cue: string, options?: PlayOptions): void {
    const declared = this.cues.get(cue);
    if (!declared) throw undeclared(cue, "looping");
    if (this.loops.has(cue)) return;

    const at = options?.at ? copyPoint(options.at) : null;
    const running: Loop = { graph: null, at };
    this.loops.set(cue, running);
    this.emit("cue:looped", {
      cue,
      t: this.now(),
      gain: this.isMuted ? 0 : nominalGain(declared),
      at,
    });

    // Without a context the loop is remembered and started from `unlock`. The
    // graph is built at the nominal gain even while muted, because the mute is
    // live: it is applied to the gain node, and lifted from it, rather than
    // deciding whether the graph exists.
    if (this.context) running.graph = this.build(declared, running.at);
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

  /**
   * Moves a running positioned loop to a world point, which is what a sound on a
   * travelling object needs each frame.
   *
   * Does nothing for a cue that is not looping, and nothing for a loop that was
   * started unpositioned: a loop that acquired a panner partway through would jump
   * from the middle of the field to a point in the world at the moment it did, and
   * the position a loop is heard from is decided once, where the game asked for
   * the loop. Nothing is announced — a move is not a transition, and the point a
   * loop started at is already on its `cue:looped`.
   *
   * Throws for a cue that was never declared, for the same reason `stop` does.
   */
  place(cue: string, at: Vec3): void {
    if (!this.cues.has(cue)) throw undeclared(cue, "placing");

    const running = this.loops.get(cue);
    if (!running?.at) return;

    running.at = copyPoint(at);
    // A loop still waiting on the unlock has recorded the move and will be built
    // where it now stands; one whose graph the context refused has nowhere to put
    // it and is silent either way.
    if (running.graph?.panner) {
      this.placePanner(running.graph.panner, running.at);
    }
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
   * rather than from its first bar, and `looping` reads the same either way. The
   * gain restored is the cue's nominal gain, ahead of the panner, so a positioned
   * loop returns to the level its distance earns it rather than to full volume.
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
   * Stands the listener where the camera stands. The engine calls this every frame
   * with the camera as it was at the most recent render — the same reading the
   * view answers from — so a positioned cue is heard from where it is seen to be.
   *
   * The pose is kept even when there is no context to write it to, because the
   * gesture that opens the context usually arrives well after the first frame:
   * without the retained pose the first cues after an unlock would be heard from
   * the origin, facing down `-Z`, whatever the game's camera had been doing.
   *
   * Only the two fields a listener has are read. A camera's projection, its
   * clipping planes and its zoom describe what it sees rather than where it
   * stands, and none of them change what an ear at that point hears.
   */
  listen(camera: CameraSnapshot): void {
    this.pose = {
      position: copyPoint(camera.position),
      rotation: { ...camera.rotation },
    };
    this.applyPose();
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
   * Every loop requested before this moment starts sounding here, at the point it
   * was last placed at, and the listener takes up the camera's latest pose. The
   * loops' events have already fired, so nothing is announced again: the game
   * asked for them then, and the unlock is only the environment catching up.
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
      // The listener first, so a loop built below is already heard from the right
      // place on the frame the gesture landed on.
      this.applyPose();
      for (const [cue, running] of this.loops) {
        const declared = this.cues.get(cue);
        if (!running.graph && declared) {
          running.graph = this.build(declared, running.at);
        }
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
   * The node a playback connects into: a fresh panner standing at `at`, already
   * wired to the destination, or the destination itself for an unpositioned cue.
   * `null` where there is nothing to play into at all.
   *
   * A one-shot's panner is not retained. It has no inputs left once its source
   * ends, which is when a browser collects both, and holding it would mean holding
   * something per play — the one thing this file refuses to do.
   */
  private sink(at: Vec3 | null): Sink | null {
    const ctx = this.context;
    if (!ctx) return null;
    if (!at) return { node: ctx.destination, panner: null };

    try {
      const panner = ctx.createPanner();
      panner.panningModel = PANNER_PANNING_MODEL;
      panner.distanceModel = PANNER_DISTANCE_MODEL;
      panner.refDistance = PANNER_REFERENCE_DISTANCE;
      panner.rolloffFactor = PANNER_ROLLOFF_FACTOR;
      panner.maxDistance = PANNER_MAX_DISTANCE;
      this.placePanner(panner, at);
      panner.connect(ctx.destination);
      return { node: panner, panner };
    } catch {
      // A context that has closed, or one whose panner objects, costs the cue its
      // sound. The event has already been emitted and the frame carries on.
      return null;
    }
  }

  /**
   * Moves a panner to a world point, through the six-`AudioParam` interface where
   * the host has one and through the older `setPosition` where it does not.
   */
  private placePanner(panner: PannerNode, at: Vec3): void {
    const when = this.context?.currentTime ?? 0;
    const target = panner as PannerTarget;

    try {
      const written =
        setParam(target.positionX, at.x, when) &&
        setParam(target.positionY, at.y, when) &&
        setParam(target.positionZ, at.z, when);
      if (!written) target.setPosition?.(at.x, at.y, at.z);
    } catch {
      // A panner whose context died under it keeps whatever position it had; the
      // loop's own record of where it stands is already updated, so a later unlock
      // or rebuild puts it in the right place.
    }
  }

  /**
   * Writes the retained camera pose to the context's listener: its position, the
   * direction it faces, and which way is up.
   *
   * A camera looks along its own `-Z` with `+Y` up, three's convention and the
   * one the engine's world is written in, so the two axes the listener wants are
   * those two turned by the camera's rotation.
   */
  private applyPose(): void {
    const ctx = this.context;
    const pose = this.pose;
    if (!ctx || !pose) return;

    const listener = ctx.listener as ListenerTarget | undefined;
    if (!listener) return;

    const forward = rotate(pose.rotation, 0, 0, -1);
    const up = rotate(pose.rotation, 0, 1, 0);
    const when = ctx.currentTime;

    try {
      const written =
        setParam(listener.positionX, pose.position.x, when) &&
        setParam(listener.positionY, pose.position.y, when) &&
        setParam(listener.positionZ, pose.position.z, when) &&
        setParam(listener.forwardX, forward.x, when) &&
        setParam(listener.forwardY, forward.y, when) &&
        setParam(listener.forwardZ, forward.z, when) &&
        setParam(listener.upX, up.x, when) &&
        setParam(listener.upY, up.y, when) &&
        setParam(listener.upZ, up.z, when);

      if (!written) {
        listener.setPosition?.(
          pose.position.x,
          pose.position.y,
          pose.position.z,
        );
        listener.setOrientation?.(
          forward.x,
          forward.y,
          forward.z,
          up.x,
          up.y,
          up.z,
        );
      }
    } catch {
      // The listener is written every frame, so a write that failed under a dying
      // context is retried on the next one at no cost. Nothing about posing the ear
      // is worth a frame.
    }
  }

  /**
   * One oscillator through one gain node into `sink`: the frequency sweeps
   * `freq → freqTo` across the cue's duration while the gain decays to silence,
   * and both nodes stop when it ends.
   *
   * Deliberately the smallest graph that produces a recognisable bleep. Richer
   * timbre is out of scope; what matters is that the cue is heard at all, that it
   * is heard from where it was placed, and that the event says it happened.
   */
  private synthesize(spec: CueSpec, gain: number, sink: AudioNode): void {
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
      amp.connect(sink);
      osc.start(start);
      osc.stop(end);
    } catch {
      // A context that has been closed, or a browser that throws from somewhere
      // inside the graph, must not take the frame down with it. The cue has already
      // been announced; the game carries on without the sound.
    }
  }

  /**
   * Plays a decoded buffer straight through to `sink`.
   *
   * No envelope and no gain node: the produced file already carries its own level
   * and its own shape, and the bus's job is to play it as generated rather than to
   * re-mix it. The node is disposable — one buffer source per play is what Web
   * Audio requires — and the browser collects it when it ends.
   */
  private sample(buffer: AudioBuffer, sink: AudioNode): void {
    const ctx = this.context;
    if (!ctx) return;

    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(sink);
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
   * drives, and a positioned loop then runs through a panner, which is what `place`
   * moves.
   *
   * A `null` graph is a loop the game still owns — `looping` reads `true` and the
   * stop is still announced — that merely cannot be heard, which is the same
   * bargain a one-shot play makes with a dead context.
   */
  private build(cue: Cue, at: Vec3 | null): LoopGraph | null {
    const ctx = this.context;
    if (!ctx) return null;

    const out = this.sink(at);
    if (!out) return null;

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
      amp.connect(out.node);
      source.start();
      return { source, amp, panner: out.panner };
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
   * Stops a loop's nodes and detaches them from whatever they fed, so the browser
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
      graph.panner?.disconnect();
    } catch {
      // A source that already stopped, or a context that closed under it, throws
      // here; either way the loop is gone, which is what was asked for.
    }
  }
}
