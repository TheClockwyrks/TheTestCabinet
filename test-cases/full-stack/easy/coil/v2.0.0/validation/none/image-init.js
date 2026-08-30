/*
 * Coil — the injected blit probe. CASE-PROVIDED.
 *
 * WHY THIS EXISTS, WHERE CAROM NEEDS NO SUCH THING. Coil is a full-stack case:
 * `specs/assets.md` requires the snake to be drawn from SEVEN produced sprites —
 * four head frames, a straight body, a corner, and a tail — each turned to the
 * cell it lands on, and eight review points turn on WHICH of them a frame painted
 * WHERE. A pong-like whose every shape is drawn in code has no such question to
 * ask, so its project reads draw calls and stops there.
 *
 * WHAT THE DRAW-CALL RECORDER CANNOT ANSWER. `recorder-init.js` reports the
 * operations of the last frame, and an operation's arguments are written the way
 * the replay format writes them: a number is a number, but an `<img>` is a marker
 * naming its CLASS (`{ $opaque: "HTMLImageElement" }`), because a bitmap is
 * carried as captured pixels in an armed recording and by nothing at all outside
 * one. Two blits of two different sprites are therefore the same pair of
 * operations, and "the image on the bend cell is not the image on the straight
 * cell" is unanswerable from them.
 *
 * SO THIS WATCHES THE BLIT ITSELF. `drawImage` is the one door a bitmap reaches a
 * 2D canvas through, so wrapping that one method on the prototype catches every
 * one, whichever context object the build drew through and whether or not a
 * recording is armed. Each blit is logged with:
 *
 *   - AN IDENTITY for the source. Sources are numbered by their URL, so two blits
 *     carry the same `id` exactly when they painted the same file, and a build
 *     that loads one file into two `Image` objects is not read as two sprites.
 *     A source with no URL of its own — an offscreen canvas, an `ImageBitmap` —
 *     is numbered by object identity instead, under its own prefix.
 *   - WHERE IT LANDED, in device pixels: the destination rectangle mapped through
 *     the transform in force at the call, so a build that translates to a cell
 *     and blits at the origin is read at the cell rather than at the origin.
 *   - WHETHER SMOOTHING WAS ON at that moment, which `specs/overview.md` requires
 *     off so the produced pixel art stays sharp. Read at the blit rather than
 *     from the frame's operations, because a build is free to set it once when it
 *     builds its context and never mention it again.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED. Which sprite is which: nothing here knows
 * that `id` 3 is the corner. `specs/assets.md` fixes the FILES, not how a build
 * names or orders the images it loads them into, so a check reads that two cells
 * were painted with different sprites, or that a cell went back to the sprite it
 * had, and never that a particular cell was painted with a particular file.
 *
 * Exposed as `window.__coilImages`. Nothing here is ever seeded into a run.
 */
(() => {
  /** Every blit the page has issued since it loaded, oldest first. */
  const blits = [];

  /** Ids handed out per source URL, so one file is one identity. */
  const byUrl = new Map();

  /** Ids handed out per source object, for a source carrying no URL. */
  const byObject = new WeakMap();

  let next = 0;

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

  window.__coilImages = {
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
        // edge vectors, which is what a rotation needs: `specs/assets.md` has
        // every sprite authored in one orientation and turned in quarter turns,
        // so a blit's `w` is `-h`'s worth of the other axis under a quarter turn.
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
        });
      } catch {
        // Watching a blit can never change one: a source the probe cannot read
        // is still drawn, and simply goes unlogged.
      }
      return drawImage.apply(this, args);
    };
  }
})();
