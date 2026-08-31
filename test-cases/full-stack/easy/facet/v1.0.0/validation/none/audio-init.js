/*
 * Facet — the injected audio probe. CASE-PROVIDED.
 *
 * WHAT THE AUDIO POINTS CAN AND CANNOT SEE HERE. Under an engine the cue bus is
 * the engine's: the game asks for a cue BY NAME and the engine announces the play
 * as an event, so a check reads the name, the frame, and the gain. An engineless
 * build writes the whole audio layer itself, so there is no bus to subscribe to
 * and no name to read — `specs/ui.md` fixes the nine cue names inside the build's
 * own code and says nothing about how a build makes a sound.
 *
 * SO THIS OBSERVES THE SOUND, NOT THE SYNTHESIS. Every way a browser can actually
 * emit audio has to go through one of two doors, and this wraps both:
 *
 *   1. A Web Audio source node has to be `start()`ed. Every source — an
 *      oscillator, a decoded or generated buffer, a constant source — shares the
 *      `AudioScheduledSourceNode` base class, so wrapping that one `start` catches
 *      every kind whatever the build synthesized with. The concrete subclasses are
 *      wrapped too, because per the Web Audio specification
 *      `AudioBufferSourceNode.start(when, offset, duration)` takes parameters the
 *      base does not and Chromium therefore gives it its OWN `start`, which
 *      SHADOWS the base one.
 *   2. A media element has to be `play()`ed. A build that ships or generates clips
 *      rather than synthesizing them is playing sound just as legitimately.
 *
 * ONE-SHOTS ARE HELD APART FROM LOOPS, AND THAT IS FACET'S OWN ADDITION.
 * `specs/ui.md` puts NINE one-shot cues over the game and TWO looping music beds
 * under it, with one of the two playing on every screen. So a start is recorded
 * with whether the source that made it LOOPS, read from `this.loop === true` at
 * the moment of the call. Without that split a check about the `select` cue could
 * be answered by the title theme starting on the same frame, which would pass a
 * build that plays no cue at all.
 *
 * THE SPLIT IS A HEURISTIC, AND HERE IS ITS EDGE. A build that loops its music by
 * re-starting a non-looping source when the previous one ends has that restart
 * counted as a one-shot. The audio context runs on real time even while the game
 * is off the clock, so such a restart can in principle land inside an observed
 * frame. A cue check should therefore observe a BOUNDED window right after posing
 * its event, and never assert an exact total over a long drive.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED. One start per cue: a blip made of a tone and
 * a noise burst is two sources and one cue, and demanding a single source would
 * fail it for a choice the specification never made. Nothing about waveform,
 * envelope, duration or gain, all of which are the build's.
 *
 * WHAT IS THEREFORE ASSERTABLE. That a sound was emitted, and WHICH FRAME of the
 * driven simulation emitted it. The cue's NAME is not observable from outside an
 * engineless build, so no check asserts it; that is a real reduction in what the
 * audio points can prove under this engine, and it is the honest one.
 *
 * Exposed as `window.__facetAudio`. Nothing here is ever seeded into a run.
 */

/*
 * This file is evaluated in the page, so the browser globals it reaches for are
 * real. The lint config a build owns is not the place to say so — it is supplied
 * with the project and never edited, and it configures the build's own sources,
 * which are TypeScript and take their globals from `tsconfig.json`'s libs. The
 * declaration therefore travels with the file that needs it.
 */
/* global window */
(() => {
  const state = { started: 0, oneShots: 0, loops: 0 };

  window.__facetAudio = {
    /** How many sounds the build has emitted since the page loaded. */
    started: () => state.started,
    /** Of those, how many came from a source that does not loop. */
    oneShots: () => state.oneShots,
    /** Of those, how many came from a looping source. */
    loops: () => state.loops,
  };

  const record = (looping) => {
    state.started += 1;
    if (looping) state.loops += 1;
    else state.oneShots += 1;
  };

  /** Whether the source starting is a looping one, as it stands at the call. */
  const loopsNow = (source) => {
    try {
      return source != null && source.loop === true;
    } catch {
      return false;
    }
  };

  /** Wrap one prototype's own `start`, if it has one. */
  const wrapStart = (proto) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "start");
    if (!descriptor || typeof descriptor.value !== "function") return;
    const original = descriptor.value;
    proto.start = function (...args) {
      record(loopsNow(this));
      return original.apply(this, args);
    };
  };

  wrapStart(window.AudioScheduledSourceNode?.prototype);
  wrapStart(window.OscillatorNode?.prototype);
  wrapStart(window.AudioBufferSourceNode?.prototype);
  wrapStart(window.ConstantSourceNode?.prototype);

  const media = window.HTMLMediaElement?.prototype;
  if (media && typeof media.play === "function") {
    const play = media.play;
    media.play = function (...args) {
      record(loopsNow(this));
      return play.apply(this, args);
    };
  }
})();
