---
title: Diagnostics
---

The debug overlay is a read-only window onto values the game names and onto the
engine's own frame metrics. The engine cannot know what is worth watching inside
someone else's simulation, so the game registers named sources and the engine
owns everything around them: the panel, the toggle key, the frame metrics, and
the read the host interface answers.

## Sources are pulled, not pushed

A source is a function that returns the value to show. It is evaluated on every
read rather than sampled at registration, so it reports whatever the game holds
at that instant. A pushed value would be a second copy of the game's state kept
current by the game remembering to update it, and a stale diagnostic is worse
than no diagnostic.

Registration order is the panel's order. Re-registering a name replaces its
source and keeps its line where it was, so redefining one value mid-run leaves
every line below it in place.

A source runs once per read, and the overlay reads once per frame while it is
visible, so a source belongs in the cheap, side-effect-free half of the game's
code. A source that throws is contained: its line carries the error message and
the remaining lines draw normally.

## One evaluation, two audiences

The panel the engine draws and the read the [host
interface](/engines/simple-2d/concepts/host/) answers both come from evaluating
the same registered sources. A person pressing the toggle sees the values a
console read returns, with no second code path to keep in step.

The read is independent of whether the panel is visible. Inspecting the game's
named values never requires switching on a piece of human-facing chrome.

## Frame metrics

The engine measures its own frames and reports them without the game registering
anything. A frame-time graph draws one bar per recent frame, and three figures
summarize the same window: the mean frame time, the 95th percentile, and the 99th
percentile.

The percentiles carry what the mean hides. An average frame time stays
comfortable while the occasional long frame a player actually feels sits in the
tail, so the two percentiles are what say whether a build is uniformly slow or
intermittently uneven.

The window is the last ten seconds of frames, held in a ring buffer of 2048
samples. Both rules bound it and neither replaces the other: age is what keeps a
stall from colouring the percentiles once the game has recovered, and capacity is
what keeps the memory constant, so a build delivering frames faster than two
hundred a second summarizes a shorter span of history in place of growing the
buffer.

The graph and the three figures occupy the top of the panel, above the registered
lines, so a game's own values keep their order below them.

## The toggle belongs to the engine

The engine listens for the backtick key on the surface's event target and flips
the overlay on each press, ignoring auto-repeat so a held key leaves the panel
steady. The key is engine chrome rather than a registered action, which keeps the
action registry exactly the game's vocabulary. The backtick key is reserved for
the engine, and the overlay starts hidden.

## Chrome over the finished picture

The overlay is drawn after the game's render, with the canvas transform reset to
the identity. Its geometry is therefore in the device pixels of the canvas
backing store rather than in the game's letterboxed logical coordinates, so debug
text stays the same physical size and stays crisp however far the game's own
coordinates are being scaled. Type size tracks the surface height with a floor
for legibility, which follows the device pixel ratio for free.

The panel sits in the top-left corner, sized to its own text, clamped to the
surface, and translucent so the game reads underneath it. The engine saves and
restores the drawing context around everything the overlay does, including when
drawing fails, so a fill style or font set for the panel stays out of the next
frame's drawing.

The overlay draws while it is enabled. Frame metrics are always available, so an
enabled panel always reports something even before the game registers a source of
its own.

## Values on one line

Each source contributes a single line pairing its name with its formatted value,
in a monospace face so columns of numbers line up and a value changing width
leaves the line where it was.

The engine owns the formatting, so a raw float is not a line of noise the reader
re-parses every frame and a small state bag is legible without the game
pre-formatting it. The exact mapping is specified in
[the diagnostics API](/engines/simple-2d/apis/diagnostics/).

Because a line is the unit, a source is expected to return about a line's worth
of information. A large object serializes to a line wider than the panel, which
is clamped to the surface.
