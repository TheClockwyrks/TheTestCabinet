/*
 * Coil — the injected audio probe. CASE-PROVIDED.
 *
 * WHAT THE AUDIO POINTS NEED, AND WHY COUNTING IS NOT ENOUGH. `specs/ui.md`
 * fixes four cues under four names and says which event plays which: `eat` on a
 * pellet eaten, `combo-up` on the multiplier rising, `death` on a fatal cell, and
 * `music` looping under a round. A tick that both eats and raises the multiplier
 * plays two of them, once each. So a probe that only counted sounds would pass a
 * build that played its death cue on every eat — and the review items are worded
 * around which cue was asked for, not around how many sounds came out.
 *
 * SO THIS NAMES THE CUE, WITHOUT ASKING THE BUILD FOR ANYTHING. An engineless
 * build writes its own audio layer, so there is no cue bus to subscribe to. What
 * there IS, fixed by `specs/assets.md` rather than by any one build, is the FILE
 * each cue plays: `assets/audio/eat.wav`, `combo-up.wav`, `death.wav`,
 * `music.wav`. A browser can only get a produced `.wav` to the speakers along one
 * of two roads, and this watches both, carrying the file's name from one end to
 * the other:
 *
 *   1. WEB AUDIO. The bytes are fetched, decoded into an `AudioBuffer`, and a
 *      buffer source is `start()`ed. So `Response.arrayBuffer` remembers which
 *      URL each buffer of bytes came from, `decodeAudioData` carries that URL
 *      onto the `AudioBuffer` it resolves, and `start()` reads it back off
 *      `this.buffer`. `XMLHttpRequest` is wrapped as well, for a build that
 *      fetches its bytes the older way.
 *   2. AN `<audio>` ELEMENT. The element is pointed at the file and `play()`ed,
 *      so the name is on `currentSrc`.
 *
 * A bundler renames a produced file — Vite writes `eat.wav` out as
 * `eat-CdXtw1S2.wav` — so the name is taken as the URL's basename with the
 * extension and a trailing content hash removed. That is general over any build
 * that ships the four files the specification names, and it is why the reduction
 * carom accepts under this engine (see its own `audio-init.js`, which can only
 * count) is not one Coil has to accept.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED. One source per cue: a build is free to layer
 * a decoded clip with a synthesized one, and demanding a single source would fail
 * it for a choice the specification never made. Nothing about waveform, envelope,
 * gain, or how a build mutes — `specs/ui.md` gives muting to the runtime, and the
 * reference happens to mute by dropping a master gain to zero, so a muted play is
 * still a play here. Nothing here knows that, and no check rests on it.
 *
 * WHAT IS THEREFORE ASSERTABLE. That a sound was emitted, WHICH cue it was when
 * the build played a produced file, whether it was asked to LOOP, and WHICH FRAME
 * of the driven simulation it went out on. A sound whose file cannot be named —
 * a synthesized flourish of the build's own, a clip inlined as a data URL —
 * arrives with a `name` of `null` and is still counted, so it is never mistaken
 * for one of the four and never silently dropped.
 *
 * Exposed as `window.__coilAudio`. Nothing here is ever seeded into a run.
 */
(() => {
  /** Every sound the page has emitted since it loaded, oldest first. */
  const plays = [];

  /** Bytes fetched, by the URL they came from. */
  const bytesFrom = new WeakMap();

  /** Decoded audio, by the URL its bytes came from. */
  const bufferFrom = new WeakMap();

  /**
   * The cue name a URL stands for: its basename, less the extension and less a
   * bundler's content hash.
   *
   * `assets/audio/combo-up-DEXxayDe.wav` is `combo-up`. The hash is stripped only
   * when it is the LAST dash-separated run and looks like one — eight or more
   * characters of a bundler's alphabet with no dash inside — so a cue whose own
   * name carries a dash keeps it.
   */
  const cueName = (url) => {
    if (typeof url !== "string" || url === "" || url.startsWith("data:")) {
      return null;
    }
    let path = url.split("#")[0].split("?")[0];
    const slash = path.lastIndexOf("/");
    if (slash >= 0) path = path.slice(slash + 1);
    const dot = path.lastIndexOf(".");
    if (dot > 0) path = path.slice(0, dot);
    const dash = path.lastIndexOf("-");
    if (dash > 0 && /^[A-Za-z0-9_]{8,}$/.test(path.slice(dash + 1))) {
      path = path.slice(0, dash);
    }
    return path === "" ? null : path;
  };

  const record = (url, loop) => {
    plays.push({
      name: cueName(url),
      url: typeof url === "string" ? url : null,
      loop: loop === true,
    });
  };

  window.__coilAudio = {
    /** How many sounds the build has emitted since the page loaded. */
    count: () => plays.length,
    /** The sounds emitted since the log held `from` of them, oldest first. */
    since: (from) => plays.slice(from),
  };

  /* ---- Road one: the bytes, the decode, and the source -------------------- */

  const response = window.Response?.prototype;
  if (response && typeof response.arrayBuffer === "function") {
    const arrayBuffer = response.arrayBuffer;
    response.arrayBuffer = function (...args) {
      const url = this.url;
      return arrayBuffer.apply(this, args).then((bytes) => {
        if (bytes && typeof url === "string") bytesFrom.set(bytes, url);
        return bytes;
      });
    };
  }

  const xhr = window.XMLHttpRequest?.prototype;
  if (xhr && typeof xhr.open === "function") {
    const open = xhr.open;
    const urls = new WeakMap();
    xhr.open = function (method, url, ...rest) {
      urls.set(this, String(url));
      return open.call(this, method, url, ...rest);
    };
    const send = xhr.send;
    xhr.send = function (...args) {
      this.addEventListener("load", () => {
        const url = urls.get(this);
        const body = this.response;
        if (body instanceof ArrayBuffer && typeof url === "string") {
          bytesFrom.set(body, url);
        }
      });
      return send.apply(this, args);
    };
  }

  // `decodeAudioData` DETACHES the bytes it is handed, so the URL is read off
  // them before the call rather than after it. Both shapes are wrapped: the
  // promise the modern signature returns, and the success callback the original
  // one takes, since a build is free to use either.
  const audioContext =
    window.BaseAudioContext?.prototype ?? window.AudioContext?.prototype;
  if (audioContext && typeof audioContext.decodeAudioData === "function") {
    const decodeAudioData = audioContext.decodeAudioData;
    audioContext.decodeAudioData = function (bytes, onDone, onFail) {
      const url = bytesFrom.get(bytes);
      const remember = (buffer) => {
        if (buffer && typeof url === "string") bufferFrom.set(buffer, url);
        return buffer;
      };
      const wrapped =
        typeof onDone === "function"
          ? (buffer) => onDone(remember(buffer))
          : onDone;
      const result = decodeAudioData.call(this, bytes, wrapped, onFail);
      return result && typeof result.then === "function"
        ? result.then(remember)
        : result;
    };
  }

  /**
   * Wrap one prototype's own `start`, if it has one.
   *
   * Every synthesized source shares `AudioScheduledSourceNode`, but per the Web
   * Audio specification `AudioBufferSourceNode.start(when, offset, duration)`
   * takes parameters the base does not and Chromium therefore gives it its OWN
   * `start`, which SHADOWS the base one. So each concrete kind is wrapped as
   * well, and the wrapper records once per call whichever one the build reached.
   */
  const wrapStart = (proto) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "start");
    if (!descriptor || typeof descriptor.value !== "function") return;
    const original = descriptor.value;
    proto.start = function (...args) {
      record(bufferFrom.get(this.buffer), this.loop);
      return original.apply(this, args);
    };
  };

  wrapStart(window.AudioScheduledSourceNode?.prototype);
  wrapStart(window.OscillatorNode?.prototype);
  wrapStart(window.AudioBufferSourceNode?.prototype);
  wrapStart(window.ConstantSourceNode?.prototype);

  /* ---- Road two: an element pointed at the file ---------------------------- */

  const media = window.HTMLMediaElement?.prototype;
  if (media && typeof media.play === "function") {
    const play = media.play;
    media.play = function (...args) {
      record(this.currentSrc || this.src, this.loop);
      return play.apply(this, args);
    };
  }
})();
