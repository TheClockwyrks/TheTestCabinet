# Midway — The economy: prices, budget, upkeep, and bankruptcy

This file defines the money loop that the whole game is scored against: where cash
comes from, the prices the player sets, what everything costs to build and run, the
budget, and how the park goes bankrupt. It builds on the park grid in
`specs/park.md` (build costs), the attractions in `specs/rides.md` (tickets and
sales), the guests in `specs/guests.md` (who pay and judge prices), and the staff in
`specs/staff.md` (wages). It feeds the reputation loop and the loss state in
`specs/flow.md`.

## The budget

The park runs on a single **cash balance**, shown in the HUD (`specs/flow.md`). It
starts at a modest opening balance (a starting loan — see the mode specs under
`specs/modes/`), rises with income, and falls with spending. It can go **negative**
(into debt); staying too deep in the red ends the park (bankruptcy, below).

- Show the **balance** and the current **income and expense rate** (per day, or a
  running per-period figure) so the player can see whether the park is making or
  losing money, not just its instantaneous cash.
- Cash is **not persisted** between sessions.

## Income

Money comes in three ways, all set by prices the player controls:

- **Admission.** Each guest that enters pays the **admission price** you set
  (`specs/guests.md`). Higher admission is more per head but turns more guests away at
  the gate.
- **Ride tickets.** Each guest that boards a ride pays that ride's **ticket price**
  (`specs/rides.md`). (You may run a park on admission-only with free rides, or on
  cheap admission and paid rides — support at least per-ride pricing so the trade-off
  is real; state your model in the `README`.)
- **Stall sales.** Each guest purchase at a food/drink/souvenir stall pays that
  stall's **price** (`specs/rides.md`).

## Setting prices

Pricing is the player's main economic lever, and guests respond to it
(`specs/guests.md`):

- The player sets the **admission price** and a **per-attraction price** for each ride
  and stall, via the price/manage tool (`specs/controls.md`) — click an attraction to
  see and change its price (and see its recent takings).
- Guests judge each price against the attraction's **perceived value**
  (`specs/guests.md`): price at or under value sells happily; price well over value
  loses sales and mood. So raising a price trades happiness (and, downstream, rating
  and arrivals) for more income per sale — a real dial, not free money.

## Expenses

Money goes out several ways:

- **Build cost.** Laying path and placing a ride, stall, or scenery costs a one-time
  price from the balance (`specs/park.md`, `specs/rides.md`); an unaffordable or
  illegal placement is refused (`specs/park.md`).
- **Upkeep.** Every ride and stall (and, if you model it, path and scenery) draws a
  small **upkeep** cost each day it stands (`specs/rides.md`). A big park costs more to
  keep open, so idle or unpopular attractions are a drain.
- **Wages.** Each staff member is paid a **wage** each period (`specs/staff.md`);
  hiring more staff raises the wage bill.
- **Repairs.** Repairing a broken ride costs money and/or a mechanic's time
  (`specs/rides.md`, `specs/staff.md`) — your choice, but a park that lets rides break
  should feel the cost.

Show the running expense side (upkeep + wages, and one-off spends) alongside income
so the player can read the park's margin.

## Bankruptcy — the loss state

The park is **lost** to **bankruptcy** when it can no longer pay its way: cash falls
below a **bankruptcy floor** (a debt limit you define) and **stays there past a short
grace period**, so a brief dip is survivable but a sustained loss is fatal. At that
point the game enters the **park-closed** state (`specs/flow.md`): it shows the run's
tally — days operated, peak guests, and any secondary measures — and offers a
restart. Bankruptcy is the only end; a solvent park runs open-ended.

Tune the opening balance, prices, costs, and guest wallets so a competent player can
build a park that turns a profit and a careless or greedy one bleeds out — the
pressure should be real but survivable. The **Downpour** start
(`specs/modes/downpour.md`) tightens the economy with weather that empties the park
and raises costs.

## The loop, together

Midway's money loop is one feedback chain: **a well-run, appealing park keeps guests
happy → happy guests lift the rating → a high rating brings more guests through the
gate → more guests spend more money → which funds a bigger, better park.** The chain
runs in reverse just as readily: overpriced or broken or filthy attractions sour the
crowd, the rating slides, arrivals dry up, income falls below upkeep and wages, and
the park spirals into the red. `specs/flow.md` makes that reputation loop and the
bankruptcy pressure explicit.
