/*
 * Shatter — the injected audio probe. CASE-PROVIDED.
 *
 * WHAT THE AUDIO ITEMS CAN AND CANNOT SEE HERE. Under an engine the cue bus is the
 * engine's: the game asks for a cue BY NAME and the engine announces the play as an
 * event, so a check reads the name, the tick and the gain. An engineless build
 * writes the whole audio layer itself — `specs/audio.md` says in as many words that
 * the layer is the build's and that it synthesizes its sounds with the Web Audio
 * API — so there is no bus to subscribe to and no name to read. The six cue names
 * `specs/audio.md` fixes live inside the build's own code, and the specification
 * says nothing about how a build makes a sound.
 *
 * SO THIS OBSERVES THE SOUND, NOT THE SYNTHESIS. Every way a browser can actually
 * emit audio has to go through one of two doors, and this wraps both:
 *
 *   1. A Web Audio source node has to be `start()`ed. Every synthesized source —
 *      an oscillator, a decoded or generated buffer, a constant source — shares
 *      the `AudioScheduledSourceNode` base class, so wrapping that one `start`
 *      catches every kind whatever the build synthesized with. The concrete
 *      subclasses are wrapped too, because per the Web Audio specification
 *      `AudioBufferSourceNode.start(when, offset, duration)` takes parameters the
 *      base does not and Chromium therefore gives it its OWN `start`, which
 *      SHADOWS the base one.
 *   2. An `<audio>` element has to be `play()`ed. A build that ships or generates
 *      clips rather than synthesizing them is playing sound just as legitimately,
 *      and `specs/audio.md` fixes the events rather than the technique.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED. One start per cue: a blip made of a tone and
 * a noise burst is two sources and one cue, and demanding a single source would
 * fail it for a choice the specification never made. Nothing about waveform,
 * envelope, duration or gain, all of which are the build's. `specs/audio.md` asks
 * only that the six cues be told apart by ear, which is a reviewer's judgement
 * rather than a measurement.
 *
 * WHAT IS THEREFORE ASSERTABLE. That a sound was emitted, and WHEN — which tick of
 * the driven simulation it was emitted on. `specs/audio.md` requires a cue on the
 * tick its event happens and at most once on that tick, so a build that sounds as
 * a rock shatters passes, a build that never sounds fails, and a build that blips
 * every tick fails on the ticks before the event. The cue's NAME is not observable
 * from outside an engineless build, so NO CHECK IN THIS PROJECT MAY ASSERT A CUE
 * NAME; that is a real reduction in what the nine audio items can prove under this
 * engine, and it is the honest one. Inferring the cue from the waveform the
 * reference happens to use would grade builds against an implementation rather
 * than against the specification.
 *
 * THE HELD CUE IS READ THE SAME WAY, FROM THE OTHER END. `specs/audio.md` makes
 * `thrust` a held cue that starts when thrust begins and stops within a tenth of a
 * second of its release, so `stopped()` counts the other door closing: every
 * `AudioScheduledSourceNode.stop()`, whatever kind of source it was. A build that
 * loops a held voice stops it once; a build that re-triggers a blip every tick
 * fails `audio/thrust-cue-starts` on the ticks before the burn began.
 *
 * Exposed as `window.__shatterAudio`. Nothing here is ever seeded into a run.
 */
(() => {
  const state = { started: 0, stopped: 0 };
  window.__shatterAudio = {
    /** How many sounds the build has emitted since the page loaded. */
    started: () => state.started,
    /** How many sounding voices the build has stopped since the page loaded. */
    stopped: () => state.stopped,
  };

  const record = (which) => {
    state[which] += 1;
  };

  /** Wrap one prototype's own `start` or `stop`, if it has one. */
  const wrapMethod = (proto, name, which) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor || typeof descriptor.value !== "function") return;
    const original = descriptor.value;
    proto[name] = function (...args) {
      record(which);
      return original.apply(this, args);
    };
  };

  for (const proto of [
    window.AudioScheduledSourceNode?.prototype,
    window.OscillatorNode?.prototype,
    window.AudioBufferSourceNode?.prototype,
    window.ConstantSourceNode?.prototype,
  ]) {
    wrapMethod(proto, "start", "started");
    wrapMethod(proto, "stop", "stopped");
  }

  const media = window.HTMLMediaElement?.prototype;
  if (media && typeof media.play === "function") {
    const play = media.play;
    media.play = function (...args) {
      record("started");
      return play.apply(this, args);
    };
  }
  if (media && typeof media.pause === "function") {
    const pause = media.pause;
    media.pause = function (...args) {
      record("stopped");
      return pause.apply(this, args);
    };
  }
})();
