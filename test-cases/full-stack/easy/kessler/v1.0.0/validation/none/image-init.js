/*
 * Kessler — the injected blit probe. CASE-PROVIDED.
 *
 * WHY THIS EXISTS. Kessler is a full-stack case: `specs/assets.md` requires the
 * planet, the five salvage pods, and the ball's six spin frames to be drawn
 * from PRODUCED sprite files, each at native size and centered on its object,
 * and review points turn on WHICH of them a frame painted WHERE — that the five
 * pod kinds are told apart in flight, that every ball is drawn from the sheet
 * with its frames advancing one per five ticks, that the planet sprite sits on
 * the stage center.
 *
 * WHAT THE DRAW-CALL RECORDER CANNOT ANSWER. `recorder-init.js` reports the
 * operations of the last frame, and an operation's arguments are written the
 * way the replay format writes them: a number is a number, but an `<img>` is a
 * marker naming its CLASS (`{ $opaque: "HTMLImageElement" }`), because a bitmap
 * is carried as captured pixels in an armed recording and by nothing at all
 * outside one. Two blits of two different sprites are therefore the same pair
 * of operations, and "the sprite on this falling pod is not the sprite on that
 * one" is unanswerable from them.
 *
 * SO THIS WATCHES THE BLIT ITSELF. `drawImage` is the one door a bitmap reaches
 * a 2D canvas through, so wrapping that one method on the prototype catches
 * every one, whichever context object the build drew through and whether or not
 * a recording is armed. Each blit is logged with:
 *
 *   - AN IDENTITY for the source. Sources are numbered by their URL, so two
 *     blits carry the same `id` exactly when they painted the same file, and a
 *     build that loads one file into two `Image` objects is not read as two
 *     sprites.
 *   - WHERE IT LANDED, in device pixels: the destination rectangle mapped
 *     through the transform in force at the call, so a build that translates to
 *     the pod and blits at the origin is read at the pod rather than at the
 *     origin. `x + w / 2, y + h / 2` is the blit's center under any transform.
 *   - WHETHER SMOOTHING WAS ON at that moment, read at the blit rather than
 *     from the frame's operations, because a build is free to set it once when
 *     it builds its context and never mention it again.
 *   - THE QUARTER TURN it was drawn under, where the transform is a whole
 *     number of quarter turns, or `null` where it is not — which in a game
 *     whose deflector rides any angle is ordinary rather than a fault.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED. Which sprite is which: nothing here knows
 * that `id` 3 is the shield pod. `specs/assets.md` fixes the FILES, not how a
 * build names or orders the images it loads them into, so a check reads that
 * two pods were painted with different sprites, or that a ball's frame changed
 * on the tick the sheet says it should, and never that a particular object was
 * painted with a particular file name.
 *
 * Exposed as `window.__kesslerImages`. Nothing here is ever seeded into a run.
 */
(() => {
  /** Every blit the page has issued since it loaded, oldest first. */
  const blits = [];

  /** Ids handed out per source URL, so one file is one identity. */
  const byUrl = new Map();

  /** Ids handed out per source object, for a source carrying no URL. */
  const byObject = new WeakMap();

  let next = 0;

  /**
   * How far from an exact quarter turn a transform may sit and still be read as
   * one, in quarter turns. A thousandth of a quarter turn is about a twelfth of
   * a degree: far below anything a build could mean by an orientation, and far
   * above the dust a composition of a letterbox fit, a translate and a rotate
   * leaves behind.
   */
  const QUARTER_TOLERANCE = 1e-3;

  /**
   * The quarter turns `m` carries the `+x` axis through, or `null` for a
   * transform that is not a whole number of quarter turns.
   *
   * Read off the LINEAR part alone — the source's `+x` axis lands on `(a, b)` —
   * so the translate that puts a sprite on its cell and the uniform scale of the
   * letterbox fit contribute nothing. `0` is the sprite drawn as authored, `1` a
   * quarter turn toward `down`, `2` a half turn, `3` a quarter turn toward `up`.
   * A reflection is measured the same way and is not rejected: what a check about
   * facing needs to know is where the edge authored on the right ended up, and
   * the image of `+x` is exactly that.
   */
  const quarterTurnsOf = (m) => {
    if (!(Math.hypot(m.a, m.b) > 0)) return null;
    const turns = Math.atan2(m.b, m.a) / (Math.PI / 2);
    const nearest = Math.round(turns);
    if (Math.abs(turns - nearest) > QUARTER_TOLERANCE) return null;
    return ((nearest % 4) + 4) % 4;
  };

  /** The URL a source draws from, or `null` for one that has none. */
  const urlOf = (source) => {
    if (source === null || typeof source !== "object") return null;
    const url = source.currentSrc || source.src;
    return typeof url === "string" && url !== "" ? url : null;
  };

  /** The identity of a blit's source: its file where it has one, else itself. */
  const identify = (source) => {
    const url = urlOf(source);
    if (url !== null) {
      let id = byUrl.get(url);
      if (id === undefined) {
        next += 1;
        id = `u${next}`;
        byUrl.set(url, id);
      }
      return id;
    }
    try {
      let id = byObject.get(source);
      if (id === undefined) {
        next += 1;
        id = `o${next}`;
        byObject.set(source, id);
      }
      return id;
    } catch {
      // A source a WeakMap will not hold is still a source the log has to name.
      return "o0";
    }
  };

  /**
   * The destination rectangle a `drawImage` call names, in the source's own
   * terms.
   *
   * The method takes three argument counts, and only the last two carry a
   * destination SIZE: `(image, dx, dy)` blits the source at its natural size,
   * which is the source's own width and height.
   */
  const destination = (source, args) => {
    if (args.length >= 9) {
      return { dx: args[5], dy: args[6], dw: args[7], dh: args[8] };
    }
    if (args.length >= 5) {
      return { dx: args[1], dy: args[2], dw: args[3], dh: args[4] };
    }
    return {
      dx: args[1],
      dy: args[2],
      dw: source?.width ?? 0,
      dh: source?.height ?? 0,
    };
  };

  window.__kesslerImages = {
    /** How many blits the build has issued since the page loaded. */
    count: () => blits.length,
    /** The blits issued since the log held `from` of them, oldest first. */
    since: (from) => blits.slice(from),
  };

  const proto = window.CanvasRenderingContext2D?.prototype;
  if (proto && typeof proto.drawImage === "function") {
    const drawImage = proto.drawImage;
    proto.drawImage = function (...args) {
      try {
        const source = args[0];
        const { dx, dy, dw, dh } = destination(source, args);
        // The transform in force, applied by hand: a destination rectangle is
        // given in user space, and where it LANDS is that rectangle under the
        // matrix. `x`/`y` are the mapped top-left corner and `w`/`h` the mapped
        // edge vectors, which is what a rotation needs: a rotated blit's
        // `w` and `h` are the mapped edge vectors rather than plain sizes.
        // The one reading a check wants is the CENTER, and `(x + w/2, y + h/2)`
        // is exactly the mapped center under any affine transform whatever.
        const m = this.getTransform();
        blits.push({
          id: identify(source),
          x: m.a * dx + m.c * dy + m.e,
          y: m.b * dx + m.d * dy + m.f,
          w: m.a * dw + m.c * dh,
          h: m.b * dw + m.d * dh,
          smoothing: this.imageSmoothingEnabled === true,
          quarterTurns: quarterTurnsOf(m),
        });
      } catch {
        // Watching a blit can never change one: a source the probe cannot read
        // is still drawn, and simply goes unlogged.
      }
      return drawImage.apply(this, args);
    };
  }
})();
