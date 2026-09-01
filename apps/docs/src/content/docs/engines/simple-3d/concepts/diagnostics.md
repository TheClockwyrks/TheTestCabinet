---
title: Diagnostics
---

The debug overlay is a read-only window onto values the game names and onto the
engine's own frame metrics. The engine cannot know what is worth watching inside
someone else's simulation, so the game registers named sources and the engine
owns everything around them: the panel, the toggle key, and the frame metrics.

## Sources are pulled, not pushed

A source is a function from the game's state to the value to show. It is
evaluated on every read rather than sampled at registration, and each read
hands it the state current at that moment. The overlay reads after the render,
so a source reports the state this frame's update returned. A pushed value would
be a second copy of the game's state kept current by the game remembering to
update it, and a stale diagnostic is worse than no diagnostic.

The state is fed to the source rather than closed over because the state is a
value each frame replaces. A source that closed over the object `initialize`
built would report the opening state for the rest of the run.

Registration order is the panel's order. Re-registering a name replaces its
source and keeps its line where it was, so redefining one value mid-run leaves
every line below it in place.

A source runs once per read, and the overlay reads once per frame while it is
visible, so a source belongs in the cheap, side-effect-free half of the game's
code. A source that throws is contained: its line carries the error message and
the remaining lines draw normally.

## An enumerable set of values

A source reports a string, a number, or a boolean. Those three are what a panel
line can say and what a check can compare, and keeping the set small is what
lets the engine own the formatting for every value a game can register.

Anything the state holds in another shape is reduced to one of the three by the
source that reports it, which is the place that knows what is worth seeing. A
position becomes a formatted string, and a collection becomes its count.

A source always reports something, so where the thing it names is absent it
reports a short placeholder string in the game's own vocabulary. The name keeps
its line, and the word on that line is one the game chose rather than one the
engine invented for it.

## Reading the values back

A caller holding the engine reads every registered source and what it reports
now, in the panel's own order, whether or not the panel is visible. Inspecting a
game's named values therefore never requires switching on a piece of
human-facing chrome, and a person pressing the toggle sees what that read
returns, with no second code path to keep in step.

Registering the values is the game's part, and drawing them is the engine's, so
a case's checks read what a build registered. A check that instead read the
drawn panel would be grading the engine's overlay in place of the build.

Each reading carries either a value or the failure its source threw, never both.
A failure is a defect in the game's own source, so it stays distinguishable from
every value a working source could report rather than arriving as a string a
check might accept as a legitimate reading.

## Frame metrics

The engine measures its own frames and reports them without the game registering
anything. A frame-time graph draws one bar per recent frame, and three figures
summarize the same window: the mean frame time, the 95th percentile, and the 99th
percentile. Two more figures describe the most recent frame alone: the draw
calls the renderer issued for it and the triangles it drew.

The percentiles carry what the mean hides. An average frame time stays
comfortable while the occasional long frame a player actually feels sits in the
tail, so the two percentiles are what say whether a build is uniformly slow or
intermittently uneven.

The draw calls and triangles carry what the timings hide. A frame time says that
a build is slow, and the two counts say whether its cost is in the scene it
submits: a game that builds a mesh per crate reads its draw calls climb with the
crate count, and one that batches reads them flat while its triangles climb
instead. The two are the renderer's own counts for the frame it most recently
rendered, read after the scene was drawn, so they describe one frame rather than
the window. Under the `headless` backend no renderer exists and both read zero.

The window is the last ten seconds of frames, held in a ring buffer of 2048
samples. Both rules bound it and neither replaces the other: age is what keeps a
stall from colouring the percentiles once the game has recovered, and capacity is
what keeps the memory constant, so a build delivering frames faster than two
hundred a second summarizes a shorter span of history in place of growing the
buffer.

The registered lines come first in the panel, in the order the game registered
them, and the five figures follow as one more line beneath them; the graph sits
beside the text, to its right. A game's own values therefore keep their place at
the top whether or not the frame-time window has any samples yet.

## The toggle belongs to the engine

The engine listens for the backtick key on the surface's event target and flips
the overlay on each press, ignoring auto-repeat so a held key leaves the panel
steady. The key is engine chrome rather than a registered action, which keeps the
action registry exactly the game's vocabulary. The backtick key is reserved for
the engine, and the overlay starts hidden.

## Chrome over the finished picture

The overlay is drawn on the [screen layer](/engines/simple-3d/concepts/rendering/)
after the game's render and after the recorder's frame bracket has closed, with
the layer's transform reset to the identity. Its geometry is therefore in the
device pixels of the canvas backing store rather than in the game's letterboxed
logical coordinates, so debug text stays the same physical size and stays crisp
however far the game's own coordinates are being scaled. Type size tracks the
surface height with a floor for legibility, which follows the device pixel ratio
for free.

The screen layer is composited over the 3D picture at the end of the frame, so
the overlay sits on top of the scene and on top of every HUD line the game drew
on the layer that frame. Drawing it after the bracket closes is what keeps it
out of every [recording](/engines/simple-3d/concepts/recording/): a recording
holds the picture the build submitted, and a debug panel is chrome rather than
picture.

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
re-parses every frame and every build's overlay reads the same way. The exact
mapping is specified in
[the diagnostics API](/engines/simple-3d/apis/diagnostics/).

Because a line is the unit, a source is expected to report about a line's worth
of information. A longer string draws a line wider than the panel, which is
clamped to the surface.
