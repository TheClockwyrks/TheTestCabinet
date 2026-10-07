/**
 * Shatter — the injected STOP counter. CASE-PROVIDED, beside the shared probe.
 *
 * WHY THIS IS THE CASE'S AND THE START COUNTER IS NOT. Every engineless case needs
 * to know that a build EMITTED a sound and on which tick, so the shared harness's
 * `audio-init.js` watches the two doors a browser can emit sound through (a Web
 * Audio source being `start()`ed, whatever kind it is, and an `<audio>` element
 * being played) and counts what goes through them. Shatter needs one thing more:
 * `specs/audio.md` makes `thrust` a HELD cue that "starts on the tick thrust
 * begins to be applied, sounds for as long as thrust is applied, and stops within
 * a tenth of a second of thrust being released". A release makes no sound, so the
 * other end of that cue is only observable as the voice being told to STOP — and
 * that is Shatter's requirement rather than every case's, so it is installed here
 * rather than pushed into the shared probe.
 *
 * IT WRAPS WHAT IS ALREADY WRAPPED, ON PURPOSE. An extra init script is injected
 * AFTER the package's own, so the `stop` this replaces is the package's wrapper
 * and both counters see every call. Nothing here reads or touches the shared
 * probe's state.
 *
 * WHAT IS NOT OBSERVABLE, HERE OR ANYWHERE. Which cue a stop belonged to: the six
 * names `specs/audio.md` fixes live inside the build's own code, and no check in
 * this project may assert a cue name. What is decidable is that a sounding voice
 * was stopped, and inside which window — which is what `specs/audio.md`'s deadline
 * asks.
 */
(() => {
  const state = { stopped: 0 };

  /** Wrap one prototype's own `stop`, if it has one. */
  const wrapStop = (proto) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "stop");
    if (!descriptor || typeof descriptor.value !== "function") return;
    const original = descriptor.value;
    proto.stop = function (...args) {
      state.stopped += 1;
      return original.apply(this, args);
    };
  };

  for (const name of [
    "AudioScheduledSourceNode",
    "OscillatorNode",
    "AudioBufferSourceNode",
    "ConstantSourceNode",
  ]) {
    wrapStop(window[name]?.prototype);
  }

  // And the other door: a build that plays clips through an `<audio>` element
  // silences a held cue by pausing it.
  const media = window.HTMLMediaElement?.prototype;
  if (media && typeof media.pause === "function") {
    const pause = media.pause;
    media.pause = function (...args) {
      state.stopped += 1;
      return pause.apply(this, args);
    };
  }

  window.__shatterStops = {
    /** How many sounding voices the build has stopped since the page loaded. */
    stopped: () => state.stopped,
  };
})();
