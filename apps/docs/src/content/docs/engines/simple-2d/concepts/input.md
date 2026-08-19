---
title: Input
---

The engine owns the keyboard. A game declares named actions and the keys that
drive them, then asks the registry what each action is doing; keyboard events
stay inside the engine.

Named actions have three consequences. An action can be driven from a key, from
a touch control, or from the host interface, and the game cannot tell which, so
a build is checkable without synthesized events. The bindings become data, which
a driver reads back as a static fact rather than inferring from behaviour. And
edge detection happens once, in the engine, instead of being re-derived in every
game.

## Named actions

An action is a name carrying a binding: the physical keys that drive it and the
kind it reports. The registered actions are the whole input vocabulary a build
speaks, and every question the game asks about the player it asks by name.

The names belong to the game. A touch layout brings a vocabulary the engine
recognizes, and a registration under any other name is equally ordinary, which
is what lets a design name the actions it actually has.

Registering a name a second time replaces its binding wholesale and returns the
action to rest, while keeping its position in the reported order. Held state
ends at a rebind because the key that was down is no longer one of the action's
keys, so no release could ever lower the action again.

## Bindings name physical keys

A binding names `KeyboardEvent.code` values rather than `key` values, so it is
independent of the keyboard layout the player types on. `KeyW` is the same
physical key on QWERTY and on AZERTY, so the WASD cluster sits in the same
place for every player.

Several keys may drive one action, and one key may drive several actions. An
action bound to several keys stays held until the last of them is released, and
a key bound to several actions raises all of them together.

## Digital and analog

The kind an action is registered with is a promise about how the game reads it.
A digital action reports a plain on or off, and any magnitude reaching it is
quantized to full deflection. An analog action reports a continuous magnitude,
which is what a touch slider or a steering axis produces; a held key gives an
analog action full deflection, since a key has no partial position.

Declaring the kind up front is what lets the engine decide what a keyboard
binding means for a given action, so a game reads one number either way and a
driver can push a partial magnitude at exactly the actions written to receive
one.

## Edges last one frame

A press is the moment an action's resolved value crosses from rest into motion,
whichever source moved it. Because every source funnels through one place, a
press means one thing: an OS auto-repeat is not a new press, and pressing a
second key bound to an already-held action is not a new press either.

An armed edge is consumed by the first read that sees it. Consumption on read is
what makes an edge safe to poll from more than one place, since a menu layer and
a gameplay layer asking about the same action in one frame must not both act on
a single press.

The frame loop closes the input frame after the game has rendered, discarding
every edge nothing consumed. A press is news for exactly one frame, so an edge
armed during a frame the game did not poll cannot surface later, out of order
with the input that caused it.

## Touch layouts

A touch layout is a vocabulary contract rather than a widget. Naming
`dual-vertical` states that the control scheme is two vertical sliders and that
the actions in play are the four the scheme drives. Selection is declarative: it
draws nothing and registers nothing, and the game still registers each action
with its own binding.

What selection does is tag provenance. An action registered while a layout is
selected, whose name is in that layout's vocabulary, is recorded as belonging to
it; every other action is recorded as the game's own. Only a layout selected
before a registration claims it, so a later selection leaves already-bound
actions attributed to where they came from.

The catalogue is closed. A name outside it fails at selection time rather than
falling back to a default, because a silent fallback would let a run be
configured for one control scheme and executed under another, leaving the run
record describing a run that never happened. Adding a layout is a deliberate
change to the engine and a new engine version.

## The menu vocabulary

Every layout carries `confirm`, `back`, `pause`, and `mute` on top of its own
vocabulary. These four are about the shell around the game rather than the game
itself, and they exist in every build however it is played, so a game binds
`pause` once and gets it under whichever layout is live.

Holding them in one place keeps the two halves of a vocabulary apart: the
catalogue entry describes the control scheme, and the menu vocabulary describes
the shell that surrounds it.

## Engine chrome stays out of the registry

The key that toggles the debug overlay is handled by a listener the engine owns,
outside the action registry. The registered actions are the read a driver uses
to confirm that a build bound everything its case asked for, and that read is
the game's vocabulary exactly because the engine keeps its own chrome out of it.
