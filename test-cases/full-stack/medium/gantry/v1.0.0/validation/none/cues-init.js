/*
 * Gantry — the injected CUE-NAMING probe. CASE-PROVIDED, beside the shared
 * harness's own audio probe.
 *
 * WHY THIS EXISTS AT ALL. `@test-cabinet/case-harness` already injects an audio
 * probe (`window.__tcabAudio`) that counts the sounds a build emits and reports
 * how many are looping, and it says plainly why it stops there: under no engine
 * there is no cue bus to subscribe to, so "the cue's NAME is not observable from
 * outside an engineless build". That is true of a case whose specification fixes
 * only the cue NAMES. Gantry's does more: `specs/assets.md` requires the build to
 * PRODUCE one `.wav` per cue in `specs/ui.md` and to "load each `.wav` the same
 * page-relative way as every other produced file, decode it with the Web Audio
 * API, and play it on the event `specs/ui.md` names". So each cue reaches the
 * speakers as an `AudioBufferSourceNode` over a buffer decoded from that cue's
 * own file, and the file is reachable: this probe follows the resource from the
 * fetch that read it, through `decodeAudioData`, to the `start()` that played it.
 *
 * WHAT THAT BUYS, AND WHAT IT COSTS. It buys the harness's `cues()`: the NAMES a
 * check reads, so `validation/audio/attach.test.ts` is one file in three engine
 * directories instead of one strong check under two engines and a weaker one
 * here. It costs a dependency on the produced file being NAMEABLE — see
 * `nameFor` below, which is deliberately generous and, when it cannot decide,
 * reports the sound under `UNNAMED` rather than guessing a cue. A check that
 * needs a name and finds `UNNAMED` fails the item, which is the honest verdict
 * for a build whose cue cannot be told from any other.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED. One source per cue: a clack made of a tone
 * and a noise burst over the SAME decoded buffer is two starts and one cue, so
 * `cues()` reports consecutive duplicates as they come and a check asks whether a
 * cue sounded rather than how many sources it took. Nothing about waveform,
 * envelope, duration or gain, all of which are the build's. And nothing about how
 * a build makes `motor` seamless: `looping()` reads the `loop` flag, and a build
 * that re-schedules the buffer end to end instead reports no looping source and
 * a stream of `motor` entries from `cues()` — which is why the harness answers
 * "is the loop running" from both readings rather than from `loop` alone.
 *
 * Exposed as `window.__gantryCues`. Nothing here is ever seeded into a run.
 */
(() => {
  /**
   * The names a played sound can be resolved to: the eleven cues of
   * `specs/ui.md`, plus the music bed of `specs/assets.md`, which is a produced
   * `.wav` like the rest and would otherwise resolve to nothing.
   */
  const NAMES = [
    "place",
    "delete",
    "run-start",
    "attach",
    "placed",
    "creak",
    "break",
    "collapse",
    "complete",
    "fail",
    "motor",
    "music",
  ];

  /** What a sound whose file could not be named is reported as. */
  const UNNAMED = "?";

  /** The sounds played since the last `take()`, in the order they started. */
  let queue = [];

  /** Every source seen starting that has not since ended, and its name. */
  const live = new Map();

  /** `ArrayBuffer` -> the URL it was read from. */
  const bufferUrls = new WeakMap();

  /** `AudioBuffer` -> the URL its bytes were decoded from. */
  const decodedUrls = new WeakMap();

  /**
   * The cue a resource path names, or `null`.
   *
   * The build commits its produced files "under `assets/` in a layout of your
   * choosing" (`specs/assets.md`) and imports each through the bundler, which
   * hashes the emitted name — `placed.wav` becomes `assets/placed-D3adB33f.wav`.
   * So the file's stem is split on `-` and every contiguous run of segments is
   * tested against the names above, longest first and left to right, and the
   * first EXACT match wins. That resolves `placed-D3adB33f` to `placed` without
   * resolving it to `place`, and `run-start-D3adB33f` to `run-start` without
   * resolving it to `start`. Anything else is left unnamed.
   */
  const nameFor = (url) => {
    if (typeof url !== "string" || url === "") return null;
    let path = url;
    try {
      path = decodeURIComponent(url.split(/[?#]/)[0] ?? url);
    } catch {
      path = url.split(/[?#]/)[0] ?? url;
    }
    const file = path.split("/").pop() ?? "";
    const stem = file.replace(/\.[^.]*$/, "").toLowerCase();
    if (stem === "") return null;
    const parts = stem.split("-").filter((part) => part !== "");
    for (let span = parts.length; span >= 1; span -= 1) {
      for (let at = 0; at + span <= parts.length; at += 1) {
        const candidate = parts.slice(at, at + span).join("-");
        if (NAMES.includes(candidate)) return candidate;
      }
    }
    return null;
  };

  /** Remember which URL a body's bytes came from, so the decode can read it. */
  const rememberBody = (buffer, url) => {
    if (buffer instanceof ArrayBuffer && typeof url === "string") {
      try {
        bufferUrls.set(buffer, url);
      } catch {
        // A detached or exotic buffer simply goes unnamed.
      }
    }
  };

  /* ---- Door one: where the bytes came from -------------------------------- */

  const response = window.Response && window.Response.prototype;
  if (response && typeof response.arrayBuffer === "function") {
    const original = response.arrayBuffer;
    response.arrayBuffer = function (...args) {
      const url = this.url;
      return original.apply(this, args).then((buffer) => {
        rememberBody(buffer, url);
        return buffer;
      });
    };
  }

  const xhr = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (xhr && typeof xhr.open === "function") {
    const open = xhr.open;
    xhr.open = function (method, url, ...rest) {
      try {
        this.__gantryUrl = String(url);
      } catch {
        // A frozen instance still loads; its buffer simply goes unnamed.
      }
      return open.call(this, method, url, ...rest);
    };
    const send = xhr.send;
    xhr.send = function (...args) {
      this.addEventListener("load", () => {
        rememberBody(this.response, this.__gantryUrl);
      });
      return send.apply(this, args);
    };
  }

  /* ---- Door one and a half: a copy of those bytes ------------------------- */

  // `decodeAudioData` DETACHES the buffer it is handed, so a build that wants to
  // keep its bytes decodes a copy — `context.decodeAudioData(bytes.slice(0))` is
  // the ordinary way to write that, and the reference implementation writes it.
  // A copy is a different object, so without this the URL is lost between the
  // fetch and the decode and every cue reports UNNAMED. That would fail a
  // conforming build for the shape of its own code, which is worse than not
  // reading cue names at all, so a slice inherits the URL its source carried.
  if (typeof ArrayBuffer.prototype.slice === "function") {
    const slice = ArrayBuffer.prototype.slice;
    ArrayBuffer.prototype.slice = function (...args) {
      const copy = slice.apply(this, args);
      const url = bufferUrls.get(this);
      if (url !== undefined) rememberBody(copy, url);
      return copy;
    };
  }

  /* ---- Door two: which decoded buffer those bytes became ------------------ */

  const audioProto = window.BaseAudioContext
    ? window.BaseAudioContext.prototype
    : window.AudioContext && window.AudioContext.prototype;
  if (audioProto && typeof audioProto.decodeAudioData === "function") {
    const decode = audioProto.decodeAudioData;
    audioProto.decodeAudioData = function (bytes, onDone, onFail) {
      // Read the URL BEFORE calling through: `decodeAudioData` detaches the
      // buffer it is handed, and a detached buffer is no longer a usable key.
      const url =
        bytes instanceof ArrayBuffer ? bufferUrls.get(bytes) : undefined;
      const keep = (decoded) => {
        if (url !== undefined && decoded) {
          try {
            decodedUrls.set(decoded, url);
          } catch {
            // See `rememberBody`.
          }
        }
        return decoded;
      };
      const wrapped =
        typeof onDone === "function"
          ? (decoded) => onDone(keep(decoded))
          : onDone;
      const result = decode.call(this, bytes, wrapped, onFail);
      // Both forms are legal; the promise form is what a modern build uses.
      return result && typeof result.then === "function"
        ? result.then(keep)
        : result;
    };
  }

  /* ---- Door three: which of them was played ------------------------------- */

  const forget = (node) => {
    live.delete(node);
  };

  const played = (node, name) => {
    queue.push(name);
    let looping = false;
    try {
      looping = node.loop === true;
    } catch {
      looping = false;
    }
    if (!looping) return;
    live.set(node, name);
    try {
      node.addEventListener("ended", () => forget(node), { once: true });
      node.addEventListener("pause", () => forget(node));
    } catch {
      // A source that refuses a listener lingers until it is stopped.
    }
  };

  const source = window.AudioBufferSourceNode
    ? window.AudioBufferSourceNode.prototype
    : null;
  if (source && typeof source.start === "function") {
    const start = source.start;
    source.start = function (...args) {
      let name = UNNAMED;
      try {
        const url = this.buffer ? decodedUrls.get(this.buffer) : undefined;
        name = (url === undefined ? null : nameFor(url)) ?? UNNAMED;
      } catch {
        name = UNNAMED;
      }
      played(this, name);
      return start.apply(this, args);
    };
    if (typeof source.stop === "function") {
      const stop = source.stop;
      source.stop = function (...args) {
        forget(this);
        return stop.apply(this, args);
      };
    }
  }

  // A source with no buffer at all — an oscillator, a constant source — is a
  // sound the build made and a cue nothing can name, so it is queued as unnamed
  // rather than dropped: a check that reads a stretch it expects to be SILENT
  // must see it.
  for (const kind of ["OscillatorNode", "ConstantSourceNode"]) {
    const proto = window[kind] && window[kind].prototype;
    if (!proto || typeof proto.start !== "function") continue;
    const start = proto.start;
    proto.start = function (...args) {
      played(this, UNNAMED);
      return start.apply(this, args);
    };
  }

  const media = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (media && typeof media.play === "function") {
    const play = media.play;
    media.play = function (...args) {
      let name = UNNAMED;
      try {
        name = nameFor(this.currentSrc || this.src) ?? UNNAMED;
      } catch {
        name = UNNAMED;
      }
      queue.push(name);
      let looping = false;
      try {
        looping = this.loop === true;
      } catch {
        looping = false;
      }
      if (looping) {
        live.set(this, name);
        try {
          this.addEventListener("ended", () => forget(this), { once: true });
          this.addEventListener("pause", () => forget(this));
        } catch {
          // See `played`.
        }
      }
      return play.apply(this, args);
    };
  }

  window.__gantryCues = {
    /** The names announced since the last read, in order, then cleared. */
    take: () => {
      const taken = queue;
      queue = [];
      return taken;
    },

    /** The same, without clearing. */
    peek: () => queue.slice(),

    /**
     * The names of the sources that are live and set to loop, right now.
     *
     * A media element also has to still be playing; a Web Audio source is live
     * until it is stopped or ends, which a looping one never does.
     */
    looping: () => {
      const names = [];
      for (const [node, name] of live) {
        let playing = true;
        try {
          if (typeof node.play === "function") {
            playing = node.paused !== true && node.ended !== true;
          }
          if (node.loop !== true) playing = false;
        } catch {
          playing = false;
        }
        if (playing) names.push(name);
      }
      return names;
    },
  };
})();
