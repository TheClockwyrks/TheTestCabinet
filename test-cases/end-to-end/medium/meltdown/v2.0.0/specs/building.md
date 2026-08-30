# Meltdown — Building

This file defines what a player does to a tower: arming a type, carrying its
preview over the floor, placing it, selecting it, upgrading it, and selling it.
`specs/controls.md` states which press or key reaches each of these, and
`specs/hud.md` what the build panel draws for them.

## Arming a type

Arming a type holds a build preview. A held preview carries four things: the type
held, the footprint's top-left tile, the rotation it is held at, and whether that
footprint could be placed right now. Disarming clears the preview entirely.

Arming a second type replaces the held one, and the held rotation returns to `0`.

## The preview follows the pointer

The held footprint is the `size x size` block nearest the pointer, clamped so
that the whole footprint stays on the grid. With the pointer at `(x, y)` in
logical stage units and the held type's footprint `size` tiles on a side:

```
col = clamp(round((x - FLOOR_X0) / TILE - size / 2), 0, COLS - size)
row = clamp(round((y - FLOOR_Y0) / TILE - size / 2), 0, ROWS - size)
```

`round` rounds a half upward and `clamp(v, lo, hi)` is `min(max(v, lo), hi)`. The
clamp is why a pointer at any corner of the floor still leaves the whole
footprint on the grid at every size.

## Valid and invalid

A held footprint is valid exactly when all six of these hold:

1. Every tile of the footprint is on the grid.
2. Every tile of the footprint is open.
3. No tile of the footprint is the tile a surge unit's centre occupies.
4. The current money is at least the held type's build cost.
5. If the mode fixes a build zone, every tile of the footprint lies inside it.
6. The placement satisfies the never-seal rule of `specs/mazing.md`.

A footprint that fails any one of them is invalid. The casing is not part of the
grid, so no footprint reaches it.

## Rotating the preview

While a preview is held, rotating advances the held rotation one step through
`0`, `1`, `2`, `3` and back to `0`, turning its radiator faces as
`specs/towers.md` states. Rotating changes only the held preview. With nothing
held, rotating changes nothing at all.

A tower's orientation is fixed at the moment it is placed: a placed tower's
rotation and its world radiator faces never change again.

## Placing

Placing commits the held preview when it is valid. On that frame:

- The money falls by exactly the type's build cost, and by nothing else.
- A tower of the held type appears on the held footprint at the held rotation, at
  level `1`, at heat `0`, not tripped, fresh, with its `spent` equal to the build
  cost, and with `0` kills and `0` damage dealt.
- Every tile of the footprint becomes blocked, and the routes are recomputed.

Placement stays armed afterward, at the same type and the same rotation, so a
second copy drops without arming again. It disarms only when the money left is
below the type's cost.

Placing on an invalid footprint builds nothing, blocks nothing, and spends
nothing.

Building is allowed whatever phase the run is in.

## Selecting

Selecting a placed tower opens its inspector on it and draws its range ring.
Selecting is by tower: one tower is selected at a time, or none. Deselecting
leaves no tower selected.

## Upgrading

Upgrading raises the selected tower one level, from `1` to `2` and from `2` to
`3`. Its cost is:

```
upgradeCost = round(buildCost * UPGRADE_COST_MULT[level - 1])
```

`UPGRADE_COST_MULT` is `1.0` at level `1` and `1.8` at level `2`, so an Arc costs
`15` to reach level II and `27` to reach level III. A tower at `MAX_LEVEL` (`3`)
reports an `upgradeCost` of `0`.

An upgrade takes effect only when the tower is below level `3` and the current
money is at least the cost. Then the money falls by exactly that cost, the cost
is added to the tower's `spent`, and every figure `specs/towers.md` scales with
level follows. An upgrade that is unaffordable, or one asked of a level III
tower, changes nothing at all.

## Freshness

A tower is fresh while it has yet to face a wave:

- A tower placed while the phase is `opening` or `building` is fresh from the
  frame it lands.
- It stops being fresh on the frame that phase becomes `wave`.
- A tower placed while the phase is already `wave` is not fresh.

Nothing makes a tower fresh again. Upgrading a tower that has already faced a
wave leaves it not fresh.

## Selling

Selling a placed tower pays its refund into the money and removes it. On that
frame every tile of its footprint reopens, the routes are recomputed, and the
selection is cleared when the tower sold was the selected one. Selling a tower
that was not selected leaves the selection where it was.

The refund is measured against everything spent on the tower, its build cost plus
every upgrade paid on it:

| The tower | Its refund |
| --- | --- |
| Fresh | `spent`, in full, with no rounding |
| Not fresh | `floor(REFUND_RATE * spent)`, which is `floor(0.7 * spent)` |
