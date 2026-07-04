# Support Foes

## Overview

This file defines the three support foes that harass you and reshape the field
alongside the worm: the **glitch**, the **packet-dropper**, and the
**corruptor**. Each is rendered from its provided sprite (`specs/assets.md`) and
each interacts with the charge field (`specs/charge.md`) or the player band
(`specs/playfield.md`) in its own way. Bounties and the exact spawn pacing are a
**starting balance** you tune (`specs/flow.md`); the behaviors here are fixed.

All three are **hostile to the cursor**: contact with the cursor costs a life
(`specs/flow.md`), the same as a worm segment reaching you. You destroy them by
shooting them (`specs/controls.md`).

## The Glitch (node-eater)

The glitch is a corrupted sprite that skitters through the lower board and
**eats the field**.

- **Behavior.** It enters from a side edge somewhere in the middle or lower rows
  and moves in a **restless zig-zag** — descending in steps and darting
  sideways —
  roaming across and down into the player band. It is quick and erratic, not a
  straight line.
- **It eats nodes.** Whenever the glitch passes over a tile holding a node, that
  node is **removed** (of any charge — it eats a critical node just as readily as
  an inert one), thinning your field and, worse, **defusing charge you were
  building** for a discharge. A glitch left alone can strip a charged cluster you
  were saving.
- **Threat and reward.** It is deadly on contact with the cursor. It dies to a
  **single bolt** and pays a bounty when killed. Because it both threatens you and
  eats your arsenal, it is usually worth shooting on sight.
- **Spawning.** Glitches begin appearing from **level 2** onward, at most one or
  two on the board at once; you design the exact cadence.

## The Packet-Dropper (field-refiller)

The dropper is a data packet that falls straight down and **reseeds the field**,
refilling terrain when it has thinned.

- **Trigger.** A dropper appears when the field has grown **too sparse** — for
  example when the count of nodes in the **lower half** of the board falls
  below a
  threshold you choose. It is the board's answer to a player who clears too much:
  the emptier you keep the field, the more droppers you draw.
- **Behavior.** It enters at the top and falls **straight down a column**,
  dropping a **fresh inert node** (`C = 0`) into empty tiles it passes on its way,
  laying a vertical trail of new terrain, then exits at the bottom. The nodes it
  drops are ordinary nodes from then on.
- **Threat and reward.** It is deadly on contact with the cursor. It takes **two
  bolts** to destroy: the **first** hit does not kill it but makes it **speed up**
  (it drops faster for the rest of its fall), and the **second** kills it and pays
  its bounty. A dropper you let finish reseeds a lane of terrain; one you kill early
  drops fewer nodes.
- **Spawning.** Droppers begin from **level 3** onward, triggered by the
  sparse-field condition rather than on a fixed timer.

## The Corruptor (charge-slammer)

The corruptor is a leggy crawler that scuttles across the upper board and
**slams the field to critical**, setting up both a detonation cluster and a worm
dive-lane.

- **Behavior.** It enters from a side edge on an **upper row** and crawls
  **horizontally** across the board to the far edge, then leaves. It does not
  descend; it works the top of the field.
- **It charges nodes to critical.** Every node the corruptor crawls over is
  **slammed straight to critical** (`C = 3`, `specs/charge.md`) — not `+1`, but
  full charge in one pass. A corruptor therefore leaves a **line of critical
  nodes** in its wake: a juicy detonation cluster for you, but also a wide
  **dive-lane** that will fast-track the worm straight down when it reaches it
  (`specs/charge.md`, `specs/worm.md`). Its amber stinger is the same amber a
  critical node shows, marking what it does.
- **Threat and reward.** It is deadly on contact with the cursor (though it stays
  high, so contact is rare). It dies to a **single bolt** and pays the largest
  bounty of the three. Killing it early cuts its critical line short.
- **Spawning.** Corruptors begin from **level 5** onward, crossing occasionally;
  you design the cadence.

## Summary

| Foe | Role | Bolts to kill | Danger |
| --- | --- | --- | --- |
| Glitch | Eats nodes (any charge), skitters the lower board | 1 | Contact; strips your charged arsenal |
| Packet-dropper | Reseeds the field when it is too sparse | 2 (speeds up after the first) | Contact; thickens the field |
| Corruptor | Slams a row of nodes to critical across the top | 1 | Contact; sets a worm dive-lane |

All three cost a life on contact with the cursor and are destroyed by your bolts.
Their bounties and how often they appear are part of the balance you design
(`specs/flow.md`).
