# Canonical state and the checksum

Correctness is checked by **checksum**: the host hashes a **canonical byte
serialization** of each snapshot and your engine matches iff its checksum equals
the reference's at every snapshot. The checksum is computed over the canonical
bytes, **not** over the JSON text, so JSON formatting differences can never
affect correctness. This is Factorio's own desync-detection model — each engine
checksums its state and a mismatch means a simulation diverged.

If you write your engine in Rust over `lattice-sdk`, you get this for free:
`Snapshot::new(tick, entities)` builds a snapshot and computes its checksum over
exactly these bytes. This document specifies the rule so a non-Rust engine can
reproduce it byte-for-byte, and so you can verify your understanding.

## The checksum: FNV-1a 64-bit

```
offset_basis = 0xcbf29ce484222325
prime        = 0x00000100000001b3

hash = offset_basis
for each byte b in the canonical bytes:
    hash = (hash XOR b) * prime          // wrapping (mod 2^64) multiply
```

The checksum string is the lowercase hex of `hash`, zero-padded to 16 digits,
with the `fnv1a64:` prefix — formatted exactly `fnv1a64:%016x`, e.g.
`fnv1a64:9f3c1a77b2e40118`.

## The canonical byte layout

All multi-byte integers are **little-endian** and **fixed-width** (no varint).
**Item ids are encoded as the item's stable `u16` index** into the prototype
item table — `iron-ore` is `0`, `iron-plate` is `1`, and so on through `circuit`
at `6` (the full index table is in `specs/prototypes.md`). They are never encoded
as the string, so the bytes are language- and format-independent.

Serialize, in order:

1. `tick: u64` — the snapshot tick.
2. `entity_count: u32` — the number of entities.
3. For **each entity, in scenario placement order**: a 1-byte `kind` tag
   followed by the entity body.

The kind tags are:

| Entity    | `kind` tag |
| --------- | ---------- |
| belt      | `0`        |
| splitter  | `1`        |
| inserter  | `2`        |
| assembler | `3`        |
| source    | `4`        |
| sink      | `5`        |

### Entity bodies

- **belt** (`kind = 0`): the **left** lane then the **right** lane. Each lane
  is:
  - `item_count: u32`, then for each item **from the output end backward**
    (ascending `pos`): `pos: u32` (units from the output end), `item: u16` (the
    item index).
- **splitter** (`kind = 1`): `rr_in: u8`, `rr_out: u8`. (A base splitter holds
  no items between ticks, so nothing else is serialized.)
- **inserter** (`kind = 2`): `phase: u8` (`idle = 0`, `swing = 1`);
  `held_present: u8` (`0`/`1`); if `held_present == 1`, `held: u16` (the item
  index) — **omitted entirely** when `held_present == 0`; `swing_left: u16`.
- **assembler** (`kind = 3`): the input buffer then the output buffer, each as a
  count map: `kinds: u8`, then `kinds` × { `item: u16`, `count: u16` } **sorted
  by item index ascending**. Then `craft_left: u16`.
- **source** (`kind = 4`): `emit_phase: u32` (= `tick % period`).
- **sink** (`kind = 5`): `kinds: u8`, then `kinds` × { `item: u16`, `count: u64`
  } **sorted by item index ascending**.

Two engines that produce an identical entity list at an identical tick build a
byte-identical buffer and therefore an identical checksum. Note the sort and
order rules carefully — the count maps are sorted by **item index**, not by
string key, and belt lanes are **left before right**, items **ascending in
`pos`**.
