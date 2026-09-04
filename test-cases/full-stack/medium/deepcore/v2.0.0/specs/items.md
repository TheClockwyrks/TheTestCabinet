# Deepcore — Field supplies and the Core Sample jettison

This file defines the six single-use field supplies bought at the Supply Depot,
and jettisoning the Core Sample as a ground item. Every figure below carries the
name this specification gives it.

## The six field supplies

A field supply is bought with Credits and carried as a count per type. Using one
consumes one.

| Hotkey | Item | Id | Price | Effect |
| --- | --- | --- | --- | --- |
| `1` | Dynamite | `dynamite` | `300` | Clears the `3x3` block of cells centered on the miner's cell. |
| `2` | Plastic Explosives | `plastic-explosives` | `1000` | Clears the `5x5` block of cells centered on the miner's cell. |
| `3` | Quantum Teleporter | `quantum-teleporter` | `1500` | Places the miner above the camp at a random height and downward speed. |
| `4` | Matter Transmitter | `matter-transmitter` | `8000` | Places the miner standing on the camp ground at zero velocity. |
| `5` | Regenerative Nanobots | `nanobots` | `4000` | Repairs `NANOBOT_HULL` (`20`) hull, capped at the maximum. |
| `6` | Emergency Fuel | `emergency-fuel` | `2000` | Adds `EMERGENCY_FUEL` (`30`) fuel, capped at the maximum. |

Using an item held zero of, or one that would change nothing, is a no-op: a note
is shown and nothing is consumed.

## Explosives

Both explosives clear a square block of cells centered on the miner's cell:
Dynamite a radius of `1` cell, Plastic Explosives a radius of `2`.

- Rock, ore, gemstone, lava, and unbreakable stone in the block all clear to
  tunnel. This is the only way through unbreakable stone.
- Ore and gemstones in the block are destroyed rather than collected.
- A gas pocket in the block detonates exactly as a drilled one does. The miner is
  at the center of the block, so a hidden pocket can hurt or kill it. Detonations
  chain within the block.
- Bedrock, material nodes, and the Core are immune and are never cleared.
- The clear is instant and costs no fuel.

## Teleporters

- The Quantum Teleporter places the miner above the camp ground at a height drawn
  uniformly from `1` to `8` tiles with a downward speed drawn uniformly from `150`
  to `700` units per second, then lets the normal physics carry it down. The
  ordinary fall-impact rule applies to the landing, so a bad draw can kill a
  low-hull miner. These two draws are a live player action and are not required to
  be reproducible from the seed.
- The Matter Transmitter places the miner standing on the camp ground at zero
  velocity, with no impact.

## Buying

Field supplies are sold at the Supply Depot, a surface building of its own. Its
panel lists the six items, each with its icon, its price, and the count held, and
disables the buy control for an item that is unaffordable. Buying one deducts its
price and increments its count.

## Using

Two paths run the same logic:

- The hotkeys `1` through `6`, which act throughout the mine, with a building
  panel or the inventory overlay open exactly as with the mine clear.
- A `USE` control per held item in the inventory overlay's field supplies section.

## Jettisoning the Core Sample

While carrying the Core Sample the miner may jettison it, dropping it onto its
current cell as a ground item so the player can move clear of the detonation.

- The jettison control is the jettison key, which acts throughout the mine with a
  panel open exactly as with the mine clear, or the `JETTISON` control in the
  inventory.
- The destabilization timer keeps running on the dropped Sample. Jettisoning
  neither pauses nor resets it.
- The ground item sits on its cell, drawn with its countdown still visible.
- A jettisoned Sample cannot be picked back up. Walking over it does nothing.
- The detonation is location-aware: carried, it kills the miner outright;
  jettisoned, its blast reaches only a miner within `CORE_BLAST_TILES` (`3`) tiles
  of the ground cell.
- Ordinary dropped ore is not a ground item; a dropped unit is simply lost.

Saving is refused while a Core Sample's timer runs, whether the Sample is carried
or lying jettisoned, so the timer is never frozen out by saving and quitting. Item
counts are carried in the save; a live Core Sample never is.
