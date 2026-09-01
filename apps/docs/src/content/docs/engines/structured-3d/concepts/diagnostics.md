---
title: Diagnostics
---

The debug overlay is a read-only window onto values a game names and onto what
the engine already knows about the open world, the frame, and the renderer. The
engine cannot know what is worth watching inside someone else's simulation, so
the game registers named sources and the engine owns everything around them:
the panel, the toggle key, the world line, and the frame metrics.

## Sources are pulled on every read

A source is a function that returns the value to show. It is evaluated on every
read rather than sampled at registration, so it reports whatever the game holds
at that instant and stays in step with the state it closes over.

Registration order is the panel's order within a registry. Re-registering a name
replaces its source and keeps its line where it was, so redefining one value
mid-run leaves every line below it in place.

A source runs once per read, and the overlay reads once per frame while it is
visible, so a source belongs in the cheap, side-effect-free half of the game's
code. A source that throws is contained: its line carries the error message and
the remaining lines draw normally.

## An enumerable set of values

A source reports a string, a number, or a boolean. Those three are what a panel
line can say and what a check can compare, and keeping the set small is what
lets the engine own the formatting for every value a game can register.

A framework object is reduced to one of the three by the source that reports it,
which is the place that knows what is worth seeing. An actor becomes its
position as a formatted string, its tag, or its count, and a collection becomes
its length.

A source always reports something, so where the thing it names is absent it
reports a short placeholder string in the game's own vocabulary. The name keeps
its line, and the word on that line is one the game chose rather than one the
engine invented for it.

## Two registries, two lifetimes

There are two registries because the framework has two lifetimes. The instance's
registry lives as long as the engine and its sources survive every level
transition. The world's registry lives as long as the world, and its sources are
dropped when the world closes, along with the world's timers.

The choice follows the object the value is read from. A figure carried on the
game instance crosses a transition intact and belongs to the instance registry.
A figure read off the world, its game mode, its game state, or an actor is
rebuilt with the world, so it belongs to the world's registry and is registered
when the world is built.

That split keeps the panel honest across travel. A world source registered on
the instance would outlive the objects it closes over and report a level that is
no longer open, while an instance source registered on the world would vanish at
the first transition.

## What every build reports

The overlay opens with the engine's own world line, giving the open level's
name, the match phase, and the number of live actors. Those three answer where a
build is before any of the game's own values are read, and the engine holds all
three already.

Frame metrics follow the registered lines. Three figures summarize the window:
the mean frame time, the 95th percentile, and the 99th percentile. Two counts
describe the most recent frame: the draw calls the renderer issued and the
triangles it drew. A frame-time graph draws one column per recent frame. The
measurement covers the frame's ticks, its collision pass, its render, and the
overlay itself, which is the whole of the work the engine drives.

The percentiles carry what the mean hides. An average frame time stays
comfortable while the occasional long frame a player actually feels sits in the
tail, so the two percentiles are what say whether a build is uniformly slow or
intermittently uneven.

The two counts carry what the timings cannot. A 3D frame's cost is dominated by
what the pipeline hands the renderer, so a slow frame is read against how much
was submitted: a few draws that each take long is a different problem from
thousands of draws that each take nothing. The counts are the renderer's own,
read after the scene has been rendered, and they describe the frame most
recently rendered rather than the window. Under the headless backend no
renderer exists and both read zero, so a check that reads them learns whether a
renderer ran, and a claim about what was submitted is checked against the
[recording](/engines/structured-3d/concepts/recording/).

The window is the last ten seconds of frames, held in a ring buffer of 2048
samples. Both rules bound it and neither replaces the other: age keeps a stall
from colouring the percentiles once the game has recovered, and capacity keeps
the memory constant, so a build delivering frames faster than two hundred a
second summarizes a shorter span of history in place of growing the buffer.

The world line comes first in the panel. The registered lines follow it, the
instance registry's in the order the instance registered them and then the
world registry's in the order the world registered them, and the three figures
and the two counts follow as one more line beneath them. The graph sits beside
the text, to its right, so a game's own values keep their place at the top
whether or not the frame-time window has any samples yet.

## One evaluation, independent of visibility

A read of the registries evaluates the same sources the panel draws, instance
registry first, whether or not the panel is visible. Inspecting the game's named
values never requires switching on a piece of human-facing chrome, and a person
pressing the toggle sees the values that read returns, with no second code path
to keep in step.

A caller holding the engine reads every registered source and what it reports
now, in the panel's own order. Registering the values is the game's part, and
drawing them is the engine's, so a case's checks read what a build registered. A
check that instead read the drawn panel would be grading the engine's overlay in
place of the build.

Each reading carries either a value or the failure its source threw, never both.
A failure is a defect in the game's own source, so it stays distinguishable from
every value a working source could report rather than arriving as a string a
check might accept as a legitimate reading.

## Chrome over the finished picture

The overlay draws last, on the screen layer, after the pipeline has rendered the
world pass and drawn the screen pass and after the recorder's frame has closed,
with the screen layer's transform reset to the identity. Its geometry is
therefore in the device pixels of the backing store, which the screen layer
shares with the canvas, rather than in the game's letterboxed logical
coordinates, so debug text stays the same physical size and stays crisp
whatever the camera is doing to the world. Type size tracks the surface height
with a floor for legibility, which follows the device pixel ratio for free.

The screen layer is composited over the 3D picture at the end of the frame, so
the panel sits over the world and over every screen-space component alike, and
because it draws after the recorder's frame closes it appears in no recording.
Under the headless backend the overlay still draws on the screen layer's
context, so the panel, when it is shown, is on the screen layer a validator
reads.

The panel sits in the top-left corner, sized to its own text, clamped to the
surface, and translucent so the game reads underneath it. The engine saves and
restores the screen layer's context around everything the overlay does,
including when drawing fails, so a fill style or font set for the panel stays
out of the next frame's drawing.

The overlay observes and draws. A build therefore behaves identically with the
panel up and with it down, and a source is expected to read the world and leave
it as it found it.

## The toggle belongs to the engine

The engine listens for the backtick key on the surface's event target and flips
the overlay on each press, ignoring auto-repeat so a held key leaves the panel
steady. The key is engine chrome rather than a registered action, which keeps
the action registry exactly the game's vocabulary and keeps the overlay outside
the input a controller reads. The backtick key is reserved for the engine, and
the overlay starts hidden.

## Values on one line

Each source contributes a single line pairing its name with its formatted value,
in a monospace face so columns of numbers line up and a value changing width
leaves the line where it was.

The engine owns the formatting, so a raw float is not a line of noise the reader
re-parses every frame and every build's overlay reads the same way. The exact
mapping is specified in
[the diagnostics API](/engines/structured-3d/apis/diagnostics/).

Because a line is the unit, a source is expected to report about a line's worth
of information. A longer string draws a line wider than the panel, which is
clamped to the surface.
