---
title: Diagnostics
---

The debug overlay is a read-only window onto values the game names. The engine
cannot know what is worth watching inside someone else's simulation, so the game
registers named sources and the engine owns everything around them: the panel,
the toggle key, and the read a driver performs.

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

The panel the engine draws and the read the host interface answers both come
from evaluating the same registered sources. A human pressing the toggle sees
the values a validation script reads back, with no second code path to keep in
step, so the overlay and the driver's view of the game cannot diverge.

The driver's read is independent of whether the panel is visible. Inspecting the
game's state never requires switching on a piece of human-facing chrome.

## The toggle belongs to the engine

The engine listens for the backtick key on the canvas's own document and flips
the overlay on each press, ignoring auto-repeat so a held key leaves the panel
steady. The key is engine chrome rather than a registered action, which keeps
the action registry exactly the game's vocabulary: a driver reading the
registered actions sees the bindings the case asked for and nothing the engine
added. The backtick key is reserved for the engine, and the overlay starts
hidden.

## Chrome over the finished picture

The overlay is drawn after the game's render, with the canvas transform reset
to the identity. Its geometry is therefore in the device pixels of the canvas
backing store rather than in the game's letterboxed logical coordinates, so
debug text stays the same physical size and stays crisp however far the game's
own coordinates are being scaled. Type size tracks the surface height with a
floor for legibility, which follows the device pixel ratio for free.

The panel sits in the top-left corner, sized to its own text, clamped to the
surface, and translucent so the game reads underneath it. The engine saves and
restores the drawing context around everything the overlay does, including when
drawing fails, so a fill style or font set for the panel stays out of the next
frame's drawing.

The overlay draws while it is enabled and at least one source is registered. An
empty panel is chrome that covers the game and reports nothing.

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
