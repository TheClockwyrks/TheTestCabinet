/*
 * Wick — the injected audio probe. CASE-PROVIDED.
 *
 * WHAT THE AUDIO POINTS NEED, AND WHY COUNTING IS NOT ENOUGH. Wick's specs fix
 * FIFTEEN cues under fixed file names (`specs/assets.md`: `assets/audio/<cue>.wav`),
 * and each rides one event (`specs/ui.md`): `hit` on damage, `kill` on a death,
 * `gem` on a collection, `hurt` on a contact hit, `level-up` when the overlay
 * opens, `choose` when an offer is accepted, `chest` when a chest overlay opens,
 * `evolve` when a weapon evolves, `pickup` on bread or a draft, `fallen` and
 * `dawn` on the two endings, `menu-move` and `menu-confirm` on the menus, and
 * the two loops `music` and `hum`. A tick that kills a moth at the lamplighter's
 * feet plays `hit`, `kill`, and `gem`, once each, so a probe that only counted
 * sounds would pass a build that played its `hit` cue three times and nothing
 * else, and the review items are worded around WHICH cue was asked for.
 *
 * SO THIS NAMES THE CUE, WITHOUT ASKING THE BUILD FOR ANYTHING. An engineless
 * build writes its own audio layer, so there is no cue bus to subscribe to. What
 * there IS, fixed by `specs/assets.md` rather than by any one build, is the FILE
 * each cue plays. A browser can only get a produced `.wav` to the speakers along
 * one of two roads, and this watches both, carrying the file's name from one end
 * to the other:
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
 * A bundler renames a produced file — Vite writes `level-up.wav` out as
 * `level-up-DX8-b1J-.wav`, and its hash may itself carry dashes — so the name is
 * taken by matching the URL's basename against the fifteen names the
 * specification fixes, longest first, either whole or followed by a dash. A file
 * that is none of the fifteen keeps its basename less a trailing hash-shaped
 * run, so a sound the build added of its own is still counted and still named
 * something.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED. One source per cue: a build is free to
 * layer a decoded clip with a synthesized one, and demanding a single source
 * would fail it for a choice the specification never made. Nothing about
 * waveform, envelope, gain, or how a build silences a bed it is asked to stop.
 *
 * WHAT IS THEREFORE ASSERTABLE. That a sound was emitted, WHICH cue it was when
 * the build played a produced file, whether it was asked to LOOP, and WHICH
 * FRAME of the driven game it went out on — the harness brackets each drive
 * around this log. A sound whose file cannot be named — a synthesized flourish
 * of the build's own, a clip inlined as a data URL — arrives with a `name` of
 * `null` and is still counted, so it is never mistaken for one of the fifteen
 * and never silently dropped.
 *
 * AND WHICH LOOPS ARE STILL SOUNDING. `specs/ui.md`: "A looping cue sounds
 * through a single source set to loop, from the frame that starts it until the
 * frame that stops it". A log of starts cannot answer whether a bed is playing
 * NOW, so a loop is held from the moment it starts until the moment it ends, and
 * `looping()` names the cues currently running. A loop ends the three ways a
 * build can end one: it is `stop()`ped, it is `disconnect()`ed from the graph,
 * or the browser reports it `ended`. An `<audio>` element ends one by being
 * paused. A build that silences its bed some other way — a gain driven to zero,
 * as muting does — is not stopping it, and is read here as still playing, which
 * is exactly what "Muting silences a running loop without stopping it" asks.
 *
 * Exposed as `window.__wickAudio`. Nothing here is ever seeded into a run.
 */
(() => {
  /** The fifteen cue names `specs/ui.md` fixes, longest first for the match. */
  const CUE_NAMES = [
    "hit",
    "kill",
    "gem",
    "hurt",
    "level-up",
    "choose",
    "chest",
    "evolve",
    "pickup",
    "fallen",
    "dawn",
    "menu-move",
    "menu-confirm",
    "music",
    "hum",
  ].sort((a, b) => b.length - a.length);

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
   * that drove the game the instant the page settled could reach an event before
   * the event's own clip had arrived, and read silence from a build that is
   * simply still starting up. The harness waits on this, under a bound: a build
   * that never decodes anything is one whose cue points fail, not one that hangs.
   */
  const decoded = [];

  /** The basename of a URL, less its query, fragment, and extension. */
  const basename = (url) => {
    let path = url.split("#")[0].split("?")[0];
    const slash = path.lastIndexOf("/");
    if (slash >= 0) path = path.slice(slash + 1);
    const dot = path.lastIndexOf(".");
    if (dot > 0) path = path.slice(0, dot);
    return path;
  };

  /**
   * The cue name a URL stands for.
   *
   * One of the fifteen when the basename IS that name or starts with it and a
   * dash (a bundler's content hash follows the dash); otherwise the basename
   * less a trailing dash-separated run of eight or more hash-alphabet
   * characters; `null` for a data URL or an empty name.
   */
  const cueName = (url) => {
    if (typeof url !== "string" || url === "" || url.startsWith("data:")) {
      return null;
    }
    const name = basename(url);
    for (const cue of CUE_NAMES) {
      if (name === cue || name.startsWith(`${cue}-`)) return cue;
    }
    const stripped = name.replace(/-[A-Za-z0-9_$-]{8,}$/, "");
    return stripped === "" ? null : stripped;
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

  window.__wickAudio = {
    /** How many sounds the build has emitted since the page loaded. */
    count: () => plays.length,
    /** The sounds emitted since the log held `from` of them, oldest first. */
    since: (from) => plays.slice(from),
    /** The cues whose files have finished decoding, oldest first. */
    decoded: () => decoded.slice(),
    /** The cues sounding as loops at this moment, each named once. */
    looping: () =>
      Array.from(new Set(running.values())).filter((name) => name !== null),
    /** How many sources are sounding as loops of `name` right now. */
    loopSources: (name) => {
      let count = 0;
      for (const held of running.values()) if (held === name) count += 1;
      return count;
    },
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
