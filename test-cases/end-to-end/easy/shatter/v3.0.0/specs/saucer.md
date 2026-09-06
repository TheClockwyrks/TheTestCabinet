# Shatter — The saucer

This file defines the enemy saucer that visits the field to hunt the ship: its
geometry, when it arrives, how it travels, when it leaves, and how it shoots. What
its bullets do when they land is in `specs/collision.md`.

## Geometry

The saucer is drawn as a flattened disc, a flying-saucer silhouette, and collides
as a circle of radius `SAUCER_R` (`18`).

It is a powered craft. The well never pulls it (`specs/gravity.md`), and it steers
clear of the star's core: at no moment does the saucer's circle overlap the core,
so its centre is never closer to `(STAR_X, STAR_Y)` than `CORE_R + SAUCER_R`
(`48`). How far outside that it chooses to steer is the build's own.

## Identity

Each arrival takes a fresh id, distinct among every entity live at that moment,
and that id is not reused while any live entity holds it. One visit is therefore
distinguishable from the next.

## The cadence

At most one saucer is on the field at a time.

| Event | Timing |
| --- | --- |
| The first arrival of a game | `SAUCER_FIRST_DELAY` (`18` seconds) of game time after the game begins |
| Each later arrival | `SAUCER_GAP_MIN` to `SAUCER_GAP_MAX` (`25` to `35` seconds), drawn uniformly, after the previous saucer leaves |

Arrivals happen while the ship is in play. A saucer already on the field is never
joined by a second.

## Entry and travel

A saucer enters at the left edge or the right, each with probability `1/2`, at a
`y` drawn uniformly from `SAUCER_R` to `FIELD_H - SAUCER_R`. It crosses the field
horizontally at `SAUCER_SPEED` (`140`), heading into the field from the edge it
entered at.

A saucer enters with no vertical component and weaves as it crosses. It carries a
weave direction, `1` for down or `-1` for up, drawn with probability `1/2` each
when it enters. Every `SAUCER_WEAVE_INTERVAL` (`1.0` second), starting one full
interval after it enters, it sets its vertical velocity to `SAUCER_WEAVE_SPEED`
(`90`) directed opposite the vertical direction it is travelling in at that
moment, so its vertical direction reverses at every reroll; a saucer with no
vertical velocity at that moment takes its weave direction instead. It wraps at
the top and bottom edges like any body.

Keeping clear of the core takes precedence over the weave. Entry rows are
drawn across the whole field, so a crossing lined up on the star's row is an
ordinary one: where holding the weave's vertical velocity would carry the
saucer's circle into the core, the saucer steers around the core instead, and
takes the weave up again once it is past.

A saucer leaves the field `SAUCER_LIFETIME` (`12` seconds) after it enters.

## Firing

Every `SAUCER_FIRE_INTERVAL` (`1.6` seconds) on the field, the saucer fires one
saucer bullet aimed at the ship's current position.

- The shot's bearing is the bearing from the saucer to the ship, offset by an
  angle drawn afresh for every shot, uniformly from `-SAUCER_AIM_ERROR` to
  `+SAUCER_AIM_ERROR` (`10` degrees). Successive shots at a stationary ship
  therefore differ.
- The bullet leaves at `SAUCER_BULLET_SPEED` (`300`) along that bearing, plus the
  saucer's own velocity.
- It collides as a circle of radius `SAUCER_BULLET_R` (`3`) and is removed
  `SAUCER_BULLET_LIFE` (`1.4` seconds) after it is fired.
- It is pulled by the well and wraps at the edges like any ballistic body.

## Posed draws

The debug surface `specs/instrumentation.md` specifies poses each draw this file
states before the game makes it: the edge and the row the next arrival enters at,
the figure the gap draw decides, a saucer's weave direction, and the aim error of
its next shot.

## What harms it

A rock passes through the saucer and neither is harmed. A bullet the ship fires
destroys the saucer, as `specs/collision.md` states.
