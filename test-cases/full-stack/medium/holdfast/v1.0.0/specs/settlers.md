# Holdfast — The settlers: needs, mood, jobs, and pathfinding (signature)

This file defines the colonists — the **settlers** — you are keeping alive: their
needs and mood, the skills that shape their work, how they pick up and do work from a
job queue, and how they move across the map. **Read this file carefully:** the
settlers' autonomy is the heart of the management game. It builds on the tile world in
`specs/world.md`, and the work it defines comes from `specs/world.md` (chopping,
mining), `specs/economy.md` (hauling, building, farming, cooking), and `specs/combat.md`
(fighting).

## The settlers

The colony starts with a small crew — about **3 settlers** — standing at the landing
site (`specs/flow.md`, `specs/mode.md`). Each is an autonomous
worker: you do **not** control a settler directly. You shape what they do by
designating work and setting priorities (`specs/controls.md`); the settlers decide who
does what and pathfind to it themselves. Each is drawn from its **produced sprite
sheets** and animates through its actions — walk, work, fight, and downed
(`specs/assets.md`).

## Needs and mood

Each settler tracks a few **needs** that its work and the environment change over
time, and a **mood** that those needs feed into. When a need is critical, tending it
becomes the settler's priority over ordinary work.

- **Hunger.** Hunger **rises** over time. A hungry settler **eats** a **meal** from
  the colony's food stock (cooked at the stove, `specs/economy.md`) to reset it. A
  settler that cannot eat because the colony has **no meals** keeps getting hungrier
  and eventually **starves** — dying, and one of the colony's loss paths
  (`specs/flow.md`).
- **Rest.** Rest **drains** as a settler works and stays awake, and drains faster at
  night (`specs/time.md`). A tired settler **sleeps** — in a **bed** it has built, or
  on the ground if it has none — to recover it, and sleeps by preference at night.
  Rest does not directly kill a settler, but a settler kept from sleep tanks its mood
  and works poorly.
- **Mood.** Mood is a summary of how the settler is doing — driven **down** by unmet
  needs (hungry, exhausted), by grim events (a colonist downed or killed, sleeping on
  the ground, fighting), and **up** by comfort (a fed, rested colonist with beds and
  space). Low mood degrades a settler's behavior: a **badly-moody settler works
  slowly, dawdles, or refuses low-priority work**, and at the extreme may stop
  contributing until things improve. Mood never itself kills a settler; it is the
  pressure that makes keeping the colony *comfortable*, not merely alive, matter.

Show each settler's needs and mood in the HUD roster (`specs/flow.md`) so the player
can see someone going hungry, exhausted, or breaking before it costs the colony.

## Skills

Each settler has a small set of **skills** that affect how well it does each kind of
work — for example a better miner clears ore faster, a better builder constructs
faster, a better cook produces meals more efficiently, a better shooter hits more
often (`specs/combat.md`). Keep the skill set small and legible; the point is that
settlers are **not interchangeable**, so the player benefits from letting the right
colonist take the right job (through priorities, below). Skills may improve with use
(your choice; state it in the `README`). Surface at least each settler's standout
skills somewhere the player can see them (the roster or a settler detail).

## Jobs and the priority queue

Work exists as a **queue of jobs** the colony needs done, and settlers pull from it.

- **Job kinds.** At least: **chop** a designated tree and **mine** a designated ore
  node (`specs/world.md`), **build** a placed order (`specs/economy.md`), **haul** a
  resource (move wood/ore/crops/meals to where they are needed — you may fold hauling
  into the other jobs if your model does not need standalone hauls, but state that in
  the `README`), **cook** at the stove (`specs/economy.md`), **farm** (sow and harvest
  plots, `specs/economy.md`), and **fight** when a raid arrives (`specs/combat.md`).
- **Priority.** The colony works through a **work-priority grid**: for each settler,
  the player sets a priority (or on/off) per **work type**, so the colony does the
  important work first and the right colonists take the right jobs (`specs/controls.md`
  states the grid). A **need** that has gone critical (eating when starving, sleeping
  when exhausted) and a **raid** (dropping tools to fight or flee, `specs/combat.md`)
  take precedence over ordinary jobs for that settler.
- **Assignment.** A free settler takes the highest-priority job it is **allowed, able,
  and able to reach**, walks to it, performs it (playing the matching animation), and
  returns to the queue for the next. A job no settler can currently reach or is allowed
  to do waits until that changes. Two settlers do not both claim the same job.

The observable behavior the viewer looks for: designate several chops, a couple of
builds, and a cook, set the work grid, and the settlers **divide the work sensibly and
get it done** — the miner mining, the builder building — tending their own needs when
those get critical and dropping everything to fight when raided, not standing idle with
work available and not all piling onto one tile.

## Pathfinding and movement

Settlers move across the map on foot; they cannot fly, teleport, or walk through
blocked tiles.

- **Walkable tiles.** A settler walks on any **walkable** tile — plain and fertile
  ground, built floors, open doorways — and **not** through rock, resource nodes,
  walls, or closed obstacles (`specs/world.md`, `specs/economy.md`). A **door** is a
  walkable structure a settler can pass but that still closes the wall line for cover
  and containment (`specs/economy.md`, `specs/combat.md`).
- **Pathfinding.** Settlers **pathfind** (a grid path search such as A\* or a
  flow-field over the walkable graph) from where they are to the tile a job needs them
  at — including the reachable tile **adjacent** to a chop/mine/build, the route to
  the stove, a farm plot, a bed, or a firing position (`specs/combat.md`). If no path
  exists, the job or destination is currently unreachable and the settler does
  something else. Movement along the path is continuous and animated; settlers do not
  jump between tiles instantly, and their speed may reflect skill or mood.
- **Blocking and rerouting.** Building a wall, or a raider standing in a doorway,
  changes the walkable graph — settlers **reroute** around new obstacles rather than
  walking through them. A colony sealed off from its own work (walls with no door)
  strands the settlers; that is the player's mistake to avoid.

## Death

A settler **dies** when it is **killed** in combat or **bleeds out** while downed
(`specs/combat.md`), or when it **starves** (hunger with no meals, above). A dead
settler stops working and is gone from the roster. When the **last** settler dies, the
colony is lost (`specs/flow.md`).
