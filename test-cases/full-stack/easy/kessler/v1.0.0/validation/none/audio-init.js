/*
 * Kessler — the injected audio probe. CASE-PROVIDED.
 *
 * WHAT THE AUDIO POINTS NEED, AND WHY COUNTING IS NOT ENOUGH. Kessler's specs
 * fix THIRTEEN cues and TWO music beds under fixed file names
 * (`specs/assets.md`), and each cue rides one event: `paddle-bounce` on the
 * deflector bounce, `target-hit` on a hit that leaves the target alive,
 * `target-break` on a destruction, `pod-catch` (`pod-catch-narrow` for a narrow
 * pod) on a catch, `ball-lost` on a burn-up, `wave-clear` on the clearing
 * event, `game-over` on entering the game-over screen, `menu-move` and
 * `menu-select` on the menus, `field-bounce` and `shield-reflect` on those
 * reflections, `pod-burn` on a pod burning up, and the beds `music-title` and
 * `music-play` looping under their screens (`specs/screens.md`,
 * `specs/assets.md`). A tick that both destroys and catches plays two cues,
 * once each — so a probe that only counted sounds would pass a build that
 * played its break cue on every catch, and the review items are worded around
 * WHICH cue was asked for.
 *
 * SO THIS NAMES THE CUE, WITHOUT ASKING THE BUILD FOR ANYTHING. An engineless
 * build writes its own audio layer, so there is no cue bus to subscribe to.
 * What there IS, fixed by `specs/assets.md` rather than by any one build, is
 * the FILE each cue plays: `assets/audio/<cue>.wav`. A browser can only get a
 * produced `.wav` to the speakers along one of two roads, and this watches
 * both, carrying the file's name from one end to the other:
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
 * A bundler renames a produced file — Vite writes `pod-catch.wav` out as
 * `pod-catch-BOib1mc4.wav` — so the name is read off the URL's basename, less
 * the extension, against the cue files `specs/assets.md` fixes: a basename that
 * is one of them, alone or ahead of a bundler's content hash, is that cue. The
 * hash is matched as a whole run rather than split at a dash, because Vite's
 * base64url alphabet can put a dash inside it (`pod-burn-D58Dkt-M.wav` is still
 * `pod-burn`), and the fixed names are tried longest first, so `pod-catch-narrow`
 * and `music-title` keep the dashes that are their own. Any other file keeps its
 * basename less a trailing hash, so a sound of the build's own is named for what
 * it played rather than mistaken for one of the cues.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED. One source per cue: a build is free to
 * layer a decoded clip with a synthesized one, and demanding a single source
 * would fail it for a choice the specification never made. Nothing about
 * waveform, envelope, gain, or how a build silences a bed it is asked to stop.
 *
 * WHAT IS THEREFORE ASSERTABLE. That a sound was emitted, WHICH cue it was when
 * the build played a produced file, whether it was asked to LOOP, and WHICH
 * TICK of the driven simulation it went out on. A sound whose file cannot be
 * named — a synthesized flourish of the build's own, a clip inlined as a data
 * URL — arrives with a `name` of `null` and is still counted, so it is never
 * mistaken for one of the thirteen and never silently dropped.
 *
 * AND WHICH LOOPS ARE STILL SOUNDING. A log of starts cannot answer whether a
 * bed is playing NOW, so a loop is held from the moment it starts until the
 * moment it ends, and `looping()` names the cues currently running. A loop ends
 * the three ways a build can end one: it is `stop()`ped, it is `disconnect()`ed
 * from the graph, or the browser reports it `ended`. An `<audio>` element ends
 * one by being paused. A build that silences its bed by some other route — a
 * gain driven to zero, a whole master bus disconnected — is not stopping it,
 * and is read here as still playing.
 *
 * Exposed as `window.__kesslerAudio`. Nothing here is ever seeded into a run.
 */
(() => {
  /** Every sound the page has emitted since it loaded, oldest first. */
  const plays = [];

  /** The cue name each loop still sounding was started under, by its source. */
  const running = new Map();

  /** Bytes fetched, by the URL they came from. */
  const bytesFrom = new WeakMap();

  /** Decoded audio, by the URL its bytes came from. */
  const bufferFrom = new WeakMap();

  /**
   * The cues whose files have finished decoding, in the order they finished.
   *
   * A build fetches and decodes its audio after the page has loaded, so a check
   * that drove the game the instant the page settled could reach the eat before
   * the eat's own clip had arrived, and read silence from a build that is simply
   * still starting up. The harness waits on this, under a bound: a build that
   * never decodes anything is one whose cue points fail, not one that hangs.
   */
  const decoded = [];

  /**
   * The produced audio files `specs/assets.md` fixes, by the cue or bed each stands for.
   *
   * Longest first, so a name that extends another is matched ahead of it.
   */
  const CUE_FILES = [
    "pod-catch-narrow",
    "shield-reflect",
    "paddle-bounce",
    "field-bounce",
    "target-break",
    "menu-select",
    "music-title",
    "target-hit",
    "wave-clear",
    "music-play",
    "pod-catch",
    "ball-lost",
    "game-over",
    "menu-move",
    "pod-burn",
  ];

  /**
   * A bundler's content hash, as the run after the basename's own name.
   *
   * Vite and Rollup write eight characters of base64url, an alphabet that
   * includes `-`, so a hash is matched as a whole run rather than split at its
   * last dash; other bundlers write eight or more of hex or base64 without one.
   */
  const HASH = /^(?:[A-Za-z0-9_-]{8}|[A-Za-z0-9_]{8,})$/;

  /**
   * The cue name a URL stands for: its basename, less the extension and less a
   * bundler's content hash.
   *
   * `assets/audio/pod-burn-DEXxayDe.wav` is `pod-burn`, and so are
   * `pod-burn-D58Dkt-M.wav` and `pod-burn.wav`. The thirteen cue names and the two beds are fixed by
   * `specs/assets.md`, so a basename that is one of them, alone or ahead of a
   * hash, is that cue. Any other file keeps its basename less a hash that stands
   * alone after its last dash, so a sound of the build's own is named for what
   * it played rather than mistaken for one of the cues.
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
    for (const cue of CUE_FILES) {
      if (path === cue) return cue;
      if (path.startsWith(`${cue}-`) && HASH.test(path.slice(cue.length + 1))) {
        return cue;
      }
    }
    const dash = path.lastIndexOf("-");
    if (dash > 0 && HASH.test(path.slice(dash + 1))) path = path.slice(0, dash);
    return path === "" ? null : path;
  };

  const record = (url, loop) => {
    const name = cueName(url);
    plays.push({
      name,
      url: typeof url === "string" ? url : null,
      loop: loop === true,
    });
    return name;
  };

  /** Hold `source` as a loop of `name` until something ends it. */
  const beginLoop = (source, name) => {
    running.set(source, name);
    if (typeof source.addEventListener === "function") {
      source.addEventListener("ended", () => running.delete(source));
    }
  };

  /** Release `source`, whether or not it was ever held. */
  const endLoop = (source) => {
    running.delete(source);
  };

  window.__kesslerAudio = {
    /** How many sounds the build has emitted since the page loaded. */
    count: () => plays.length,
    /** The sounds emitted since the log held `from` of them, oldest first. */
    since: (from) => plays.slice(from),
    /** The cues whose files have finished decoding, oldest first. */
    decoded: () => decoded.slice(),
    /** The cues sounding as loops at this moment, each named once. */
    looping: () =>
      Array.from(new Set(running.values())).filter((name) => name !== null),
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
        if (buffer && typeof url === "string") {
          bufferFrom.set(buffer, url);
          const name = cueName(url);
          if (name !== null && !decoded.includes(name)) decoded.push(name);
        }
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
      const name = record(bufferFrom.get(this.buffer), this.loop);
      if (this.loop === true) beginLoop(this, name);
      return original.apply(this, args);
    };
  };

  /** Wrap one prototype's own `stop`, the same way and for the same reason. */
  const wrapStop = (proto) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "stop");
    if (!descriptor || typeof descriptor.value !== "function") return;
    const original = descriptor.value;
    proto.stop = function (...args) {
      endLoop(this);
      return original.apply(this, args);
    };
  };

  for (const proto of [
    window.AudioScheduledSourceNode?.prototype,
    window.OscillatorNode?.prototype,
    window.AudioBufferSourceNode?.prototype,
    window.ConstantSourceNode?.prototype,
  ]) {
    wrapStart(proto);
    wrapStop(proto);
  }

  // A source cut out of the graph is no longer sounding, whether or not it was
  // also stopped.
  const node = window.AudioNode?.prototype;
  if (node && typeof node.disconnect === "function") {
    const disconnect = node.disconnect;
    node.disconnect = function (...args) {
      endLoop(this);
      return disconnect.apply(this, args);
    };
  }

  /* ---- Road two: an element pointed at the file ---------------------------- */

  const media = window.HTMLMediaElement?.prototype;
  if (media && typeof media.play === "function") {
    const play = media.play;
    media.play = function (...args) {
      const name = record(this.currentSrc || this.src, this.loop);
      if (this.loop === true) beginLoop(this, name);
      return play.apply(this, args);
    };
  }
  if (media && typeof media.pause === "function") {
    const pause = media.pause;
    media.pause = function (...args) {
      endLoop(this);
      return pause.apply(this, args);
    };
  }
})();
