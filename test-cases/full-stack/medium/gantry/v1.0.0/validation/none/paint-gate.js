// Gantry — the paint gate. THE VALIDATOR PROJECT'S OWN INSTRUMENTATION, injected
// before a line of the build runs, exactly as `cues-init.js` is.
//
// WHY THIS EXISTS. An engineless check reaches the build the only way anything
// reaches it: a round trip into the page. Measured against this case's own
// reference, one such crossing costs about 16ms while the page is painting on its
// own and about 1.6ms while it is not — the work inside the page is a rounding
// error either way (a whole frame of Gantry's draw is under half a millisecond),
// so what a crossing spends is almost entirely waiting for the renderer to reach
// a point where it will answer. Multiplied by the crossings this project drives,
// that is the difference between a suite run that fits the platform's cap and one
// that is stopped by it — and a stopped run decides NO point at all.
//
// WHY IT IS SOUND, which matters more than what it saves. `specs/instrumentation.md`
// fixes what a check is owed: `advance(ticks)` runs "`ticks` whole frames,
// immediately and in order, each covering `1 / TICK_HZ` seconds of elapsed time
// and each followed by a render". The render a validator reads is therefore the
// one `advance` itself performs. The frames the build's loop paints BETWEEN two
// calls are frames no check is promised and no check reads — off the run screen
// with the wall clock stopped they redraw a world that did not change. This holds
// those frames back and lets `advance`'s own render through, so what a check sees
// is what the specification says it sees.
//
// It is the same move the harness already makes with `setAutoStep(false)`: the
// game comes off the wall clock so it changes only when a check says so. This
// takes it off the paint clock so it draws only when a check says so.
//
// WHAT STILL DRAWS, AND WHAT DOES NOT. `advance` runs the build's own frames, and
// a frame draws the canvas — that is the render the specification promises and it
// is untouched here, because it happens inside the call rather than in a frame the
// page asked the platform for. What a held page does NOT do is run the build's
// LOOP callback, so anything a build refreshes there and nowhere else — this
// case's reference draws its diagnostics overlay that way — stands still until a
// frame is pumped. Two things pump one:
//   * `capture` — one before every still, so what is composited is the page as
//     it stands. Nothing else a check reads off the canvas needs one: that is
//     drawn by `advance`'s own render.
//   * `paint()` — one for a check whose evidence is a state it posed rather than
//     one the simulation ran into, so the frame the still is of is drawn over the
//     pose rather than over the tick after it.
//   * `paintFrames(count)` — the check about the clock, which runs the frames the
//     BUILD asked for rather than the ones a check asked for.
//
// A PUMPED FRAME IS THE FRAME THE PAGE WOULD HAVE HAD. The callback is handed a
// timestamp `1000 / 60` of a second past the last one, which is what a page
// painting freely would have handed it, so a build that steps from its frame
// loop steps exactly as far in a pumped frame as in a real one.
//
// A build that never calls `requestAnimationFrame` is unaffected in every part.
(() => {
  var HANDLE = "__gantry";
  var GLOBAL = "__gantryPaint";
  // Synthetic handles live far above anything the platform hands out, so a
  // `cancelAnimationFrame` can never confuse one of ours for one of its own.
  var ID_BASE = 1e9;

  var realRequest = window.requestAnimationFrame.bind(window);
  var realCancel = window.cancelAnimationFrame.bind(window);

  var held = false;
  var nextId = ID_BASE;
  var queued = new Map();
  var order = [];
  var clock = 0;

  /**
   * A callback the page is allowed to run now, plus the two things a real frame
   * is the right moment for: remembering the clock the page is being driven on,
   * and noticing that the build has finished standing itself up.
   */
  function passThrough(callback) {
    return function (time) {
      clock = time;
      callback(time);
      settle();
    };
  }

  /**
   * Take the page off its own paint clock the instant the build's surface is
   * answering.
   *
   * Deliberately NOT done at document start: the build is free to install its
   * surface from inside its first frame, and a page held before that would never
   * reach one.
   */
  function settle() {
    var surface = window[HANDLE];
    if (surface === undefined || typeof surface.snapshot !== "function") return;
    held = true;
  }

  function runQueued(times) {
    for (var n = 0; n < times; n += 1) {
      var ids = order;
      order = [];
      if (ids.length === 0) return;
      clock += 1000 / 60;
      for (var i = 0; i < ids.length; i += 1) {
        var callback = queued.get(ids[i]);
        queued.delete(ids[i]);
        if (callback !== undefined) callback(clock);
      }
    }
  }

  var api = {
    /** Run `count` (default one) of the frames the page has asked for. */
    pump: function (count) {
      runQueued(count === undefined ? 1 : count);
    },
  };

  window.requestAnimationFrame = function (callback) {
    if (!held) return realRequest(passThrough(callback));
    nextId += 1;
    queued.set(nextId, callback);
    order.push(nextId);
    return nextId;
  };

  window.cancelAnimationFrame = function (handle) {
    if (queued.delete(handle)) {
      var at = order.indexOf(handle);
      if (at >= 0) order.splice(at, 1);
      return;
    }
    realCancel(handle);
  };

  window[GLOBAL] = api;
})();
