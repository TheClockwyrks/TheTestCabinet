---
title: Input
---

The engine owns the keyboard and the pointer. A game declares its named actions
and the keys that drive them while it initializes, then asks by name what each
action is doing while it updates; the pointer it reads as a position already in
its own logical coordinates. Key and pointer events are handled inside the
engine.

Named actions have three consequences. An action is driven by a key or by a
touch control and the game reads one number either way, so a build is
examinable by delivering input at the same seam a player uses. The bindings are
data the engine holds rather than logic spread through event handlers, so one
place resolves what a build bound. And edge detection happens once, in the
engine, in place of being re-derived in every game.

## Named actions

An action is a name carrying a binding: the physical keys that drive it and the
kind it reports. The registered actions are the whole input vocabulary a build
speaks, and every question the game asks about the player it asks by name.

The names belong to the game. A touch layout brings a vocabulary the engine
recognizes, and a registration under any other name is equally ordinary, which
is what lets a design name the actions it actually has.

Registering happens during initialization, so the vocabulary is complete before
the first frame reads it. Registering a name a second time replaces its binding
wholesale and returns the action to rest, keeping its position in the
registration order.

## Bindings name physical keys

A binding names `KeyboardEvent.code` values rather than `key` values, so it is
independent of the keyboard layout the player types on. `KeyW` is the same
physical key on QWERTY and on AZERTY, so the WASD cluster sits in the same place
for every player.

The engine listens for those events on the event target its surface supplies,
which is the canvas's owning document in a browser. A caller that dispatches key
events into a target of its own therefore reaches the actions by the path a
player's keystrokes take.

Several keys may drive one action, and one key may drive several actions. An
action bound to several keys stays held until the last of them is released, and
a key bound to several actions raises all of them together.

## Digital and analog

The kind an action is registered with is a promise about how the game reads it.
A digital action reports a plain on or off, and any magnitude reaching it is
quantized to full deflection. An analog action reports a continuous magnitude,
which is what a touch stick or a steering axis produces; a held key gives an
analog action full deflection, since a key has one position.

Declaring the kind up front is what lets the engine decide what a keyboard
binding means for a given action, so the game reads one number whichever source
moved it and a partial magnitude lands only on the actions written to receive
one.

## Edges last one frame

A press is the moment an action's resolved value crosses from rest into motion,
whichever source moved it. Because every source funnels through one place, a
press means one thing: an OS auto-repeat is a continuation of the hold, and
pressing a second key bound to an already-held action leaves the action held.

An armed edge is consumed by the first read that sees it. Consumption on read is
what makes an edge safe to poll from more than one place, since a menu layer and
a gameplay layer asking about the same action in one frame share the one press
between them.

The frame loop closes the input frame after the game has rendered, discarding
every edge nothing consumed. A press is news for exactly one frame, so an edge
armed during a frame the game did not poll stays in that frame rather than
surfacing later, out of order with the input that caused it.

## The pointer

The pointer is the one input whose meaning depends on where the picture is: a
click is a claim about a position on the stage, and the stage sits letterboxed
and scaled inside whatever element the page gave the canvas. The engine owns
that conversion for the same reason it owns the canvas fit: every pointer game
otherwise re-derives it, usually forgetting the device pixel ratio or the bars.
The position a game reads is therefore in the logical coordinates the screen
layer draws in.

In 3D the stage point is the start of a second conversion. A position on the
stage names a line through the world rather than a point in it, and the game
turns the position into a world-space ray through the
[view](/engines/simple-3d/concepts/camera-and-view/), against the camera the
player is looking through. The pointer stays in logical coordinates so that a
HUD hit test and a world pick read the same position, one directly and one
through the ray.

A game reads the pointer two ways, and they serve different designs. The
snapshot answers "where is the pointer now, and is it held", which is what
aiming and hovering need. The sample list holds every position delivered since
the last frame closed, in arrival order, which is what direct manipulation
needs: a game that reacts to the path the pointer traveled resolves each sample
on its own rather than seeing only where the sweep ended.

Press and release edges follow the same rule as action edges: armed by the
transition, consumed by the first read, and discarded when the frame closes.
The snapshot and the edges follow the primary pointer, so a mouse and a touch
drive the game the same way, and a multi-touch gesture's second finger reaches
the game through the contacts and the samples alone.

## Touch layouts

A touch layout is a vocabulary contract rather than a widget. Naming
`dual-stick` states that the control scheme is two analog sticks and that the
actions in play are the eight the scheme drives. Selection is declarative: it
draws nothing and registers nothing, and the game still registers each action
with its own binding.

A layout is selected when the engine is created, so every registration the game
makes happens under it. An action whose name is in the selected layout's
vocabulary is recorded as belonging to that layout, and every other action is
recorded as the game's own.

The catalogue is closed. A name outside it fails at construction, because a
silent fallback to a default would let a run be configured for one control
scheme and executed under another, leaving the run record describing a run that
never happened. Adding a layout is a deliberate change to the engine and a new
engine version.

## The 3D catalogue

| Layout | Controls | Own vocabulary |
| --- | --- | --- |
| `dpad-4` | A four-way pad | `up`, `down`, `left`, `right` |
| `dpad-4-two-buttons` | A four-way pad and two action buttons | `up`, `down`, `left`, `right`, `a`, `b` |
| `single-stick` | One analog stick | `move-up`, `move-down`, `move-left`, `move-right` |
| `dual-stick` | Two analog sticks | `move-up`, `move-down`, `move-left`, `move-right`, `look-up`, `look-down`, `look-left`, `look-right` |
| `dual-stick-two-buttons` | Two analog sticks and two action buttons | The `dual-stick` vocabulary followed by `a`, `b` |

The pads are digital and the sticks are analog. A 3D game moves through a
world and turns a camera, which is two axes each, so the catalogue pairs a
move stick with a look stick and offers the four-way pad for a game that moves
on a grid. A game that needs two buttons beside either takes the two-button
entry, and a game with a control scheme outside the catalogue registers its
own actions under any names it likes.

## Sticks are unipolar analog actions

A stick has two axes and four directions, and it reaches the game as four
actions rather than two signed numbers. A stick's deflection is split by
direction into magnitudes in `0..1`, so a stick pushed up and to the right
drives `move-up` and `move-right` by the components of its deflection and
leaves `move-down` and `move-left` at rest. Each direction is an action like
any other: it has a binding, a kind, a value, and a press edge.

Splitting by direction is what lets a key and a stick drive the same action. A
held `KeyW` gives `move-up` full deflection, and a stick pushed half way up
gives it half, and the game reads one number either way. A game registers a
stick's four actions as analog, which is what lets the value carry the
deflection rather than quantizing it to full, and rebuilds the signed axis it
wants by subtracting one direction from its opposite.

## The menu vocabulary

Every layout carries `confirm`, `back`, `pause`, and `mute` on top of its own
vocabulary. These four are about the shell around the game rather than the game
itself, and they exist in every build however it is played, so a game binds
`pause` once and gets it under whichever layout is live.

Holding them in one place keeps the two halves of a vocabulary apart: the
catalogue entry describes the control scheme, and the menu vocabulary describes
the shell that surrounds it.

## Engine chrome stays out of the actions

The key that toggles the debug overlay is handled by a listener the engine owns,
outside the registered actions. The actions are the game's vocabulary exactly,
and the overlay toggle reaches the engine whatever the game bound.
