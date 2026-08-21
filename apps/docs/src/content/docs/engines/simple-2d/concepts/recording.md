---
title: Recording
---

The engine carries a flight recorder over the drawing context. Armed, it keeps
every operation a frame issued, along with enough context state to draw that
frame on its own. What comes back is the build's own drawing rather than a
re-shoot of it, which is what makes a recording usable as evidence a reviewer
sees beside the same scenario driven against the reference implementation.

## A stable wrapper the game cannot escape

The engine draws through a wrapper over the 2D context, built once when the
engine is constructed and handed out for the engine's whole life. The wrapper
forwards every call and every assignment to the real context, so the pixels are
the same whether or not anything is being captured, and records only while it is
armed.

The identity is stable because a game holds on to what it was given. A wrapper
installed at the moment recording started would be a different object from the
one a game captured on an earlier frame, and that game would keep drawing
through the context it already held. Arming is therefore a flag inside one
wrapper rather than a substitution of one context for another.

The engine's own frame preparation draws through the same wrapper as the game's
`render`, so the clear and the viewport transform are part of the recording. A
replayed frame starts from the blank, correctly transformed page the original
started from.

## Per-frame inherited state

A frame's own operations are not enough to draw it. A game that sets a font on
its first frame relies on the context still carrying that font a thousand frames
later, and a player that seeks straight to frame 900 has no earlier frame to
have inherited it from.

Each frame therefore carries the context state it inherited, snapshotted before
the frame's first operation. Drawing a frame means restoring that state and
replaying that frame's operations, and nothing else. Taking the snapshot at the
end of a frame instead would record the state the frame left behind, and replay
would draw the frame's opening operations under its closing style.

The state covers what survives a frame boundary: the style properties, the
transform, and the dash pattern. Reads are individually guarded, because the set
of properties a context carries differs between a browser and the native canvas
a [validator](/engines/simple-2d/validators/overview/) builds on. A property
that is absent is left out, which is the same outcome as a context that never
had it.

## Independent frames make scrubbing parallel

Because every frame stands alone, seeking to a frame costs what drawing that
frame costs. A player jumps to frame 900 directly rather than replaying the 899
before it, which is what makes a scrub bar responsive over a recording of any
length.

The same property is what lets two recordings be scrubbed in step. A reviewer
moves one control and both the build's recording and the reference
implementation's are drawn at the frame that control names, with neither of them
having to be replayed from the beginning. The frame counter and the accumulated
simulated time travel with each frame, so the two are aligned on the figure the
engine stepped rather than on a wall clock.

## Interning what the context produced

Some of what a build draws with is created through the context and then mutated
through the object the context returned. A gradient is created by a call and
then given its color stops through the value that call handed back, so a
recorder watching only the context would record the creation and miss every
stop.

Anything the context returns is therefore given an id and wrapped in turn. Calls
made on it are recorded against that id, and a later use of it as an argument or
an assigned value is recorded as a reference to that id. Replay recreates the
value by re-issuing the operation that produced it and resolves each reference
against what it produced.

Arguments cross the wrapper unwrapped, because a native context refuses one of
these wrappers where it expects one of its own objects. The wrapping is
therefore invisible to the context and visible to the recorder. A value the
recorder cannot carry at all is recorded as an opaque marker naming its type, so
a player reports the one operation it cannot reproduce instead of drawing
something else.

## The frame bracket excludes the overlay

A frame opens before the engine prepares the canvas and closes after the game's
`render` returns, which leaves the
[diagnostics](/engines/simple-2d/concepts/diagnostics/) overlay outside it. The
overlay is chrome drawn over the finished picture, in device pixels with the
transform reset, and baking a debug panel into a reviewer's evidence would
misreport what the build drew.

The bracket is also what makes arming cheap to reason about. Capture begins at
the next frame, so a caller that arms the recorder mid-frame gets whole frames
rather than a frame whose clear and transform had already happened. A frame
still open when the recorder is disarmed is dropped, because the recording it
would have joined has already been handed to its caller.

## Armed around a section, idle otherwise

The recorder is armed and disarmed by whoever owns the engine, so a check
records the section of a scenario it is about and pays nothing for the setup
that got there. While it is idle the wrapper costs one property lookup and one
call per operation and accumulates nothing, so an engine that is never asked to
record has the same footprint after a million frames as after one.

A recording holds what the build drew through the context the engine handed it.
A build that draws to a surface of its own is drawing outside the recording, and
a frame that emits no operations while its pixels change is the signal that it
did.
