/**
 * The engine's audio bus: named cues, played by name, announced as events.
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
 * Playing is *observed* rather than recorded. A driver cannot listen to a headless
 * browser, so "did the build make a noise when the ball bounced" has to be
 * answerable from outside — but an engine-owned log would have to keep every cue
 * of every run against the chance that something reads it, and that grows for as
 * long as the game plays. Each play instead publishes `cue:played` synchronously,
 * inside the call, so a subscriber runs while the frame that played the cue is
 * still running and keeps exactly the shape of record it wants. Nothing in this
 * file grows with the number of plays: the only thing retained is one entry per
 * declared cue name, which the game fixes during its initialization.
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
 * The one thing that *does* throw is playing a cue that was never declared: that
 * is a typo in the build, silence is the expected outcome of a muted or still
 * locked bus, so the mistake would otherwise be indistinguishable from a cue that
 * played inaudibly and would survive to the end of the run unnoticed.
 */
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
 * Creates the browser's audio context, or `null` where there isn't one.
 *
 * A browser with no Web Audio at all and a test with no fake take the same path
 * out of here, which is why degradation needs no separate mode.
 */
function defaultContextFactory() {
    const ctor = globalThis
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
function nominalGain(cue) {
    return cue.kind === "synth"
        ? (cue.spec.gain ?? DEFAULT_CUE_GAIN)
        : FILE_CUE_GAIN;
}
/** The engine's audio bus. */
export class AudioBus {
    emit;
    now;
    decode;
    factory;
    cues = new Map();
    context = null;
    isMuted = false;
    isUnlocked = false;
    constructor(options = {}) {
        this.emit = options.emit ?? (() => { });
        this.now = options.now ?? (() => 0);
        this.decode =
            options.loadAudio ??
                ((path) => Promise.reject(new Error(`audio "${path}" cannot be loaded: this bus was built with no asset loader`)));
        this.factory = options.audioContext ?? defaultContextFactory;
    }
    /**
     * Declares a synthesized cue under a name.
     *
     * Declaring a name that already holds a cue replaces it, of either kind, which
     * is what lets a sound be retuned without tearing the bus down.
     */
    define(cue, spec) {
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
     * unchanged, and the loader has already announced the failure.
     */
    async load(cue, path) {
        const buffer = await this.decode(path);
        this.cues.set(cue, { kind: "file", buffer });
    }
    /**
     * Plays a declared cue: announces it, then sounds it if anything can be heard.
     *
     * Throws if the cue was never declared. Silence is the expected outcome of a
     * muted or still-locked bus, so a typo'd name would otherwise disappear into the
     * same silence and never be noticed.
     */
    play(cue) {
        const declared = this.cues.get(cue);
        if (!declared) {
            throw new Error(`unknown audio cue "${cue}" — declare it with audio.define("${cue}", spec) or audio.load("${cue}", path) before playing it`);
        }
        // Mute is a gain of zero in the event rather than a missing event, so a driver
        // can still establish that the build reacted and can tell a muted game apart
        // from an unresponsive one.
        const gain = this.isMuted ? 0 : nominalGain(declared);
        this.emit("cue:played", { cue, t: this.now(), gain });
        // Below this line is audibility alone. No context yet (still locked, or no
        // audio support at all), or nothing to hear anyway, and the event is the whole
        // of what the play did.
        if (!this.context || gain <= 0)
            return;
        if (declared.kind === "synth")
            this.synthesize(declared.spec, gain);
        else
            this.sample(declared.buffer);
    }
    /** Mutes or unmutes the bus. A muted cue still plays — at gain zero. */
    setMuted(muted) {
        this.isMuted = muted;
    }
    /** Whether the bus is muted. */
    muted() {
        return this.isMuted;
    }
    /** The bus's observable state: whether it is muted, and whether it is unlocked. */
    state() {
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
     */
    unlock() {
        if (this.isUnlocked)
            return;
        this.isUnlocked = true;
        try {
            this.context = this.factory();
            // A context created inside a gesture usually starts running, but one carried
            // over from a suspended page does not; resuming is cheap and covers both.
            this.context?.resume().catch(() => undefined);
        }
        catch {
            // A browser that refuses us a context is one the game runs in silently, not
            // one it fails to run in. The context assignment happens before the resume,
            // so a context that objects to being resumed is still kept.
        }
        this.emit("audio:unlocked", {});
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
    synthesize(spec, gain) {
        const ctx = this.context;
        if (!ctx)
            return;
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
        }
        catch {
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
    sample(buffer) {
        const ctx = this.context;
        if (!ctx)
            return;
        try {
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start();
        }
        catch {
            // Same bargain as synthesis: a dead context costs the sound, never the frame.
        }
    }
}
//# sourceMappingURL=audio.js.map