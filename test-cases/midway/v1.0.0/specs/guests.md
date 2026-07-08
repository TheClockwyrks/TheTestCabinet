# Midway — The guests: desires, choices, spending, and happiness (signature)

This file defines the signature system of Midway: the guests. They enter at the
gate, act on a model of **desires**, pathfind the park to satisfy them, spend money
on what they want at prices they judge, and leave — happy or not, and that
happiness decides whether the park thrives or dies. **Read this file carefully.**
It builds on the park grid in `specs/park.md`, drives the queues in
`specs/rides.md`, spends through `specs/economy.md`, and feeds the reputation loop
in `specs/flow.md`.

## Arrivals and departures

- **Arrivals.** Guests appear at the **entrance gate** (`specs/park.md`) at an
  **arrival rate driven by the park's rating** (`specs/flow.md`): a well-rated park
  draws a steady stream, a poorly-rated one dwindles to a trickle. On entering, a
  guest **pays admission** (`specs/economy.md`) and receives a starting **wallet** of
  cash to spend inside; a guest who thinks admission is not worth it (rating low,
  price high) may **balk at the gate** and not enter.
- **Departures.** A guest **leaves** — walking back to the gate and out — when it has
  spent (or nearly spent) its wallet, when its desires are met and it is content to
  go home, or when it is **too unhappy to stay**. How a guest leaves matters: a happy
  guest leaving is a good review (nudging rating up), an angry guest leaving early is
  a bad one (dragging rating down), which is how the crowd's mood becomes the park's
  reputation (`specs/flow.md`).

## The desire model

Each guest carries a small vector of **desires** (needs) plus a **wallet** and a
**happiness**. Desires change over time and with what the guest does; the guest acts
on whichever is most pressing that it can afford and reach.

- **Thrill** — the wish to ride something. Rises over time (a guest who has not
  ridden anything gets bored) and is satisfied by riding, more so by a more thrilling
  ride (`specs/rides.md`).
- **Hunger** — rises over time; satisfied by buying from a **food stall**
  (`specs/rides.md`).
- **Thirst** — rises over time (and faster after a ride or in heat); satisfied at a
  **drink stall**.
- **Bladder** — rises over time, faster after drinking; relieved at a **restroom**.
  A guest with a full bladder and no restroom in reach gets unhappy fast.
- **Energy** — falls as the guest walks; a tired guest wants to **rest** on a bench
  (`specs/park.md`) to recover it before doing more. Energy does not end a guest's
  visit by itself; it gates how far it will roam.
- **Wallet** — the cash the guest brought. Everything it buys is drawn from this;
  when it runs low the guest heads home.
- **Happiness** — the guest's mood (below), the thing the whole game is tuned around.

Show a selected guest's desires in an **inspector** (`specs/flow.md`,
`specs/controls.md`) and the **average happiness** in the HUD, so the player can see
the crowd's state and why.

## Choosing what to do

A free guest (not currently walking, queuing, riding, or buying) **decides its next
action** from its desires and what the park offers:

- It weighs its **most pressing** desires against the **reachable** attractions that
  serve them (a ride for thrill, a food/drink stall for hunger/thirst, a restroom for
  bladder, a bench for energy), each within reach on the **path graph**
  (`specs/park.md`) and **affordable** at its price (`specs/economy.md`).
- It picks a target — generally the strongest desire it can satisfy — and **pathfinds
  to that target's entrance / queue tile**. A guest will not choose an attraction it
  cannot reach or cannot afford; if nothing appeals (everything too dear, too far, or
  broken), it wanders, rests, or gives up and leaves.
- **Queue tolerance.** A guest sizes up a ride's **queue** before joining
  (`specs/rides.md`): a short line is fine, a very long one deters it (it balks and
  looks elsewhere), and once in line an overlong wait bleeds its happiness and it may
  give up and leave the queue. Guests are not infinitely patient.

The observable behavior the reviewer looks for: guests **spread across the park**
acting on plausibly different desires — some queuing for rides, some eating, some at
the restroom, some resting or leaving — not all walking to one tile or standing idle
with attractions available.

## Spending and value

Guests spend real money, and they judge whether each purchase is worth it.

- Every ride ticket, stall purchase, and the admission is drawn from the guest's
  **wallet** and added to the park's income (`specs/economy.md`).
- **Price versus value.** Each attraction has a **perceived value** — from its thrill
  or the quality of what it sells, reduced by a long queue, a breakdown, or a dirty,
  unappealing setting. A guest compares the **price you set** against that value: a
  price at or below value is a happy purchase; a price well above value makes the
  guest **refuse** (or buy grudgingly and lose happiness). Pricing is therefore a real
  lever — you can raise prices for more income per guest at the cost of mood and
  refusals, or keep them keen and cheap. `specs/economy.md` defines the money; this
  file defines that guests **react** to it.

## Happiness

Happiness is the guest's running mood, the value everything ultimately moves:

- It **rises** from satisfying a desire (a good ride, a wanted snack), from a fair-
  or-cheap price, and from walking clean, **appealing** decorated paths
  (`specs/park.md`), and from an entertainer nearby (`specs/staff.md`).
- It **falls** from long queues and waits, overpriced attractions, unmet pressing
  desires (bursting bladder, no food in reach), **litter** underfoot (`specs/staff.md`),
  broken rides (`specs/rides.md`), and getting lost with nothing reachable.
- A guest's happiness shades its behavior: a happy guest stays, rides more, and
  spends; an unhappy guest stops buying and, past a threshold, **leaves early with a
  bad review**. The **average happiness across the crowd** is a top-line HUD vital and
  the main input to the park **rating** (`specs/flow.md`).

## Pathfinding and movement

Guests (and staff, `specs/staff.md`) move on foot along the path network; they do not
cut across grass, water, or built footprints.

- **Walkable tiles.** A guest walks only on **path** tiles and the **queue tiles** of
  attractions attached to them (`specs/park.md`, `specs/rides.md`). Grass, water,
  ride/stall bodies, and scenery are not walkable.
- **Pathfinding.** Guests **pathfind** (a grid path search such as A\* or BFS over the
  path graph) from where they are to the entrance tile of their chosen target — a
  ride's or stall's queue, a bench, or the gate to leave. If no path exists (the
  target is stranded, or a path was removed), that target is unreachable and the guest
  chooses something else. Movement along the path is continuous and animated; guests
  do not teleport between tiles, and many guests share the paths, so popular routes
  visibly crowd.
- Guests are drawn from **produced sprite sheets** and **animate through their
  states** — walking, and visibly **happy**, **angry**, or **eating** as their mood and
  action dictate (`specs/assets.md`) — so a glance at the crowd reads its mood.
