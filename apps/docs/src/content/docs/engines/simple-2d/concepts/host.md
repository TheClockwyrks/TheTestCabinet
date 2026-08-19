---
title: The Host Interface
---

The host interface is the seam a driver binds to in order to operate a build
rather than play it. Through it a validation script takes the frame clock,
drives the named actions, and reads back what the build played, requested, and
reported.

## Installed by createEngine

`createEngine` installs the interface. A build that runs at all is therefore a
build that is driveable, and the contract is identical for every case that
selects the engine.

Under [no engine](/testing/end-to-end/instrumentation/) the build supplies the
whole instrumentation surface itself. That surface is model-written code, so it
can be absent, misnamed, or subtly different from the one the case described,
and a validation script driving it has to be written defensively around all
three. The engine's operations are engine code, so a script written against them
holds for every build of every case that selects the engine.

The interface covers the surfaces the engine owns: the frame clock, the action
registry, the audio bus, the asset loader, and the debug overlay. A case's own
instrumentation carries what is left, which is everything about that particular
game: resetting it, posing a scenario, and reading its state back.

## The handle and the version

The interface is published as a single property of the game's own window, named
by the handle. The engine's manifest declares the same handle, and the two are
one contract: a driver takes the name from the engine catalogue and binds to
whatever the catalogue says.

The interface also carries an integer version, bumped whenever an operation's
shape or meaning changes. A driver reads it first, and can then report that a
build predates the operation it needs rather than calling a missing function and
reporting a broken build.

## Plain data only

Everything the interface returns is plain data. A driver reads these values out
of a page evaluation, which structured-clones them across the browser boundary,
and a class instance, a live internal array, a function, or a cyclic object
either arrives mangled or throws and takes the whole read with it. Each
subsystem hands back a copy of its own record, so a reader can neither observe
live internal state nor rewrite the record of what the build did.

Diagnostics are the one place the values originate in game code and can
therefore be anything at all. They are reduced to a plain form on the way out: a
value that is already plain crosses unchanged, one that is not degrades to its
string form, and one with no representation at all reads as null. A single
careless source costs its own line rather than every other diagnostic at once.

## The untrusted boundary

Arguments arrive as untyped JSON from outside the type system, so the static
types are a claim rather than a guarantee. An invented clock mode, a jitter
schedule whose upper bound sits below its lower one, and a magnitude that is not
a number are all things a driver actually sends, and each is rejected at this
boundary with the offending value named in the message.

Rejecting them here is what keeps a bad call looking like a bad call. A page
whose clock is neither of the two known modes never runs another frame, and a
magnitude of `NaN` leaves a digital action held forever and poisons every
quantity the game multiplies by it. Both surface far from the call that caused
them, and both read as a hung or broken build.

## Installation and teardown

Installing over an existing handle replaces it. A page that tears one engine
down and builds another, as a level transition or a reload does, must end up
driveable by the engine that is actually running, and a refusal there would
leave the page owned by a dead engine.

Teardown removes the handle only while it still belongs to the engine being
destroyed. The order teardown tends to happen in creates the replacement first
and disposes of the superseded engine afterwards, so a superseded engine's
destruction leaves its replacement published.
