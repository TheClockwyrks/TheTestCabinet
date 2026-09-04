/*
 * Arc Foundry — the injected audio probe. CASE-PROVIDED.
 *
 * WHAT THE AUDIO POINTS CAN AND CANNOT SEE HERE. Under an engine the cue bus is
 * the engine's: the game asks for a cue BY NAME and the engine announces the play
 * as an event, so a check reads the name, the frame, and the gain. An engineless
 * build writes the whole audio layer itself, so there is no bus to subscribe to
 * and no name to read — `specs/ui.md` fixes the twelve cue names inside the
 * build's own code and says nothing about how a build makes a sound.
 *
 * SO THIS OBSERVES THE SOUND, NOT THE SYNTHESIS. Every way a browser can actually
 * emit audio has to go through one of two doors, and this wraps both:
 *
 *   1. A Web Audio source node has to be `start()`ed. Every source a build can
 *      play — an oscillator, a decoded `.wav` the build produced, a generated
 *      buffer, a constant source — shares the `AudioScheduledSourceNode` base
 *      class, so wrapping that one `start` catches every kind whatever the build
 *      played. The concrete subclasses are wrapped too, because per the Web Audio
 *      specification `AudioBufferSourceNode.start(when, offset, duration)` takes
 *      parameters the base does not and Chromium therefore gives it its OWN
 *      `start`, which SHADOWS the base one — and a build playing the produced
 *      files of `specs/assets.md` plays them through exactly that node.
 *   2. An `<audio>` element has to be `play()`ed. A build that plays its produced
 *      clips through elements rather than through the Web Audio graph is playing
 *      sound just as legitimately.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED. One start per cue: a firing blip made of a
 * tone and a noise burst is two sources and one cue, and demanding a single
 * source would fail it for a choice the specification never made. Nothing about
 * waveform, envelope, duration or gain, all of which are the build's. The looping
 * music cue is a source like any other, so a check that counts sounds over a
 * stretch of frames counts whatever the bed started in it too.
 *
 * WHAT IS THEREFORE ASSERTABLE. That a sound was emitted, and WHEN — which frame
 * of the driven simulation it was emitted on. `specs/ui.md` requires a cue on the
 * update its event happens and at most once on that update, so a build that
 * sounds on the kill passes, a build that never sounds fails, and a build that
 * blips every frame fails on the frames before the event. The cue's NAME is not
 * observable from outside an engineless build, so no check asserts it; that is a
 * real reduction in what the audio points can prove under this engine, and it is
 * the honest one.
 *
 * Exposed as `window.__foundryAudio`. Nothing here is ever seeded into a run.
 */
(() => {
  const state = { started: 0 };
  window.__foundryAudio = {
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
