/*
 * Fathom — the injected audio probe. CASE-PROVIDED.
 *
 * WHAT THE AUDIO POINTS CAN AND CANNOT SEE HERE. Under an engine the cue bus is
 * the engine's: the game asks for a cue BY NAME and the engine announces the play
 * as an event, so a check reads the name, the frame, and the gain. An engineless
 * build writes the whole audio layer itself, so there is no bus to subscribe to
 * and no name to read — `specs/progression.md` fixes the seven cue names inside the
 * build's own code and says nothing about how a build makes a sound.
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
 *      clips rather than synthesizing them is playing sound just as legitimately.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED. One start per cue: a blip made of a tone and
 * a noise burst is two sources and one cue, and demanding a single source would
 * fail it for a choice the specification never made. Nothing about waveform,
 * envelope, duration or gain, all of which are the build's. `specs/progression.md`
 * asks only that the seven cues be told apart by ear, which is a reviewer's
 * judgement rather than a measurement.
 *
 * WHAT IS THEREFORE ASSERTABLE. That a sound was emitted, and WHEN — which frame
 * of the driven simulation it was emitted on. `specs/progression.md` requires a
 * cue on the TICK its event happens and at most one on that tick, so a build that
 * sounds as the forager swallows a plankton passes, a build that never sounds
 * fails, and a build that blips every tick fails on the ticks before the event.
 * The cue's NAME is not observable from outside an engineless build, so no check
 * asserts it; that is a real reduction in what these seven points can prove under
 * this engine, and it is the honest one.
 *
 * Exposed as `window.__fathomAudio`. Nothing here is ever seeded into a run.
 */
(() => {
  const state = { started: 0 };
  window.__fathomAudio = {
    /** How many sounds the build has emitted since the page loaded. */
    started: () => state.started,
  };

  const record = () => {
    state.started += 1;
  };

  /** Wrap one prototype's own `start`, if it has one. */
  const wrapStart = (proto) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "start");
    if (!descriptor || typeof descriptor.value !== "function") return;
    const original = descriptor.value;
    proto.start = function (...args) {
      record();
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
      record();
      return play.apply(this, args);
    };
  }
})();
