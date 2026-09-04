/*
 * The injected audio probe for an engineless (`none`) build.
 *
 * WHAT THE AUDIO POINTS CAN AND CANNOT SEE HERE. Under an engine the cue bus is
 * the engine's: the game asks for a cue BY NAME and the engine announces the play
 * as an event, so a check reads the name, the tick, and the gain. An engineless
 * build writes the whole audio layer itself, so there is no bus to subscribe to
 * and no name to read — a case's specs fix the cue names inside the build's own
 * code and say nothing about how a build makes a sound.
 *
 * SO THIS OBSERVES THE SOUND, NOT THE SYNTHESIS. Every way a browser can actually
 * emit audio has to go through one of two doors, and this wraps both:
 *
 *   1. A Web Audio source node has to be `start()`ed. Every source — an
 *      oscillator, a decoded or generated buffer, a constant source — shares the
 *      `AudioScheduledSourceNode` base class, so wrapping that one `start` catches
 *      every kind whatever the build synthesized or decoded with. The concrete
 *      subclasses are wrapped too, because per the Web Audio specification
 *      `AudioBufferSourceNode.start(when, offset, duration)` takes parameters the
 *      base does not and Chromium therefore gives it its OWN `start`, which
 *      SHADOWS the base one.
 *   2. An `<audio>` element has to be `play()`ed. A build that ships or generates
 *      clips rather than decoding them into buffers is playing sound just as
 *      legitimately.
 *
 * AND IT WATCHES WHAT IS STILL SOUNDING. A case may require a music bed to LOOP
 * under the game rather than play once, so the probe also reports how many of
 * the sources it has seen are still live and looping. `loop` is read
 * at the moment the question is asked rather than at the start, because a build
 * is free to set the flag either side of the call, and a source is dropped from
 * the live set when it is stopped, when it ends, or when the element is paused.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED. One start per cue: a blip made of a tone and
 * a noise burst is two sources and one cue, and demanding a single source would
 * fail it for a choice the specification never made. Nothing about waveform,
 * envelope, duration or gain, all of which are the build's. And nothing about HOW
 * a bed is made seamless: a build that re-schedules the buffer end to end rather
 * than setting `loop` is conformant, so a check that finds no looping source
 * falls back to the sound the bed is making.
 *
 * WHAT IS THEREFORE ASSERTABLE. That a sound was emitted, and WHEN — which tick
 * of the driven simulation it was emitted on. Where a case requires a cue on the
 * tick its event happens, and exactly one cue per event, a build that sounds on
 * that tick passes, a build that never sounds fails, and a build that blips every
 * tick fails on the ticks before the event. The cue's NAME is not observable from
 * outside an engineless build, so no check asserts it; that is a real reduction
 * in what an audio point can prove under this engine, and it is the honest one.
 *
 * Exposed as `window.__tcabAudio`. Nothing here is ever seeded into a run.
 */
(() => {
  const state = { started: 0, loopStarts: 0 };

  /**
   * The sources seen starting that have not since ended.
   *
   * Bounded, because a run's cues are thousands of sources over a long drive and
   * the set is only ever asked how many of them are looping. A bed is started
   * once and lives for the whole drive, so the oldest entries are the ones worth
   * keeping when the bound is reached — but an entry that has ended is worth
   * nothing at all, so the sweep drops those first and only then refuses.
   */
  const LIVE_MAX = 256;
  const live = new Set();

  const record = () => {
    state.started += 1;
  };

  /** Whether this source is, at this instant, set to loop. */
  const isLooping = (node) => {
    try {
      return node.loop === true;
    } catch {
      return false;
    }
  };

  /** Whether an `<audio>`/`<video>` element is still playing. */
  const isPlaying = (node) => {
    try {
      return node.paused !== true && node.ended !== true;
    } catch {
      return false;
    }
  };

  const forget = (node) => {
    live.delete(node);
  };

  const remember = (node) => {
    if (live.size >= LIVE_MAX) {
      for (const held of live) {
        if (!isLooping(held)) live.delete(held);
      }
      if (live.size >= LIVE_MAX) return;
    }
    live.add(node);
    if (isLooping(node)) state.loopStarts += 1;
    try {
      node.addEventListener?.("ended", () => forget(node), { once: true });
      node.addEventListener?.("pause", () => forget(node));
    } catch {
      // A source that refuses a listener is still counted; it simply lingers in
      // the live set until the sweep above drops it.
    }
  };

  /** Wrap one prototype's own `start`, if it has one. */
  const wrapStart = (proto) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "start");
    if (!descriptor || typeof descriptor.value !== "function") return;
    const original = descriptor.value;
    proto.start = function (...args) {
      record();
      remember(this);
      return original.apply(this, args);
    };
  };

  /** Wrap one prototype's own `stop`, so a stopped source leaves the live set. */
  const wrapStop = (proto) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "stop");
    if (!descriptor || typeof descriptor.value !== "function") return;
    const original = descriptor.value;
    proto.stop = function (...args) {
      forget(this);
      return original.apply(this, args);
    };
  };

  for (const name of [
    "AudioScheduledSourceNode",
    "OscillatorNode",
    "AudioBufferSourceNode",
    "ConstantSourceNode",
  ]) {
    wrapStart(window[name]?.prototype);
    wrapStop(window[name]?.prototype);
  }

  const media = window.HTMLMediaElement?.prototype;
  if (media && typeof media.play === "function") {
    const play = media.play;
    media.play = function (...args) {
      record();
      remember(this);
      return play.apply(this, args);
    };
  }

  window.__tcabAudio = {
    /** How many sounds the build has emitted since the page loaded. */
    started: () => state.started,

    /**
     * How many sources are still live AND set to loop, right now.
     *
     * A media element also has to still be playing; a Web Audio source is live
     * until it is stopped or ends, which is what a looping one never does.
     */
    looping: () => {
      let count = 0;
      for (const node of live) {
        if (!isLooping(node)) continue;
        if (typeof node.play === "function" && !isPlaying(node)) continue;
        count += 1;
      }
      return count;
    },

    /** How many of the sounds emitted were looping when they started. */
    loopStarts: () => state.loopStarts,
  };
})();
