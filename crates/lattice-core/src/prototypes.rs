//! The fixed constants of the Lattice world — the **prototype table**.
//!
//! Everything here is authoritative and is mirrored verbatim in the case's
//! `specs/prototypes.md`. A scenario *refers* to prototypes by name (`"tier":
//! "fast"`, `"recipe": "iron-gear"`); it never redefines them, so these are the
//! single source of truth the reference engine and the model's engine both read
//! from the case rather than guess.
//!
//! Every value is an **integer** (fixed-point) — there is no floating-point
//! arithmetic anywhere in the model, which is what makes "the state after *N*
//! ticks" a single bit-exact value (see [`crate::state`] for the canonical
//! serialization that hashes it).

/// Position units per tile of lane length. A power of two; an item's position on
/// a lane is measured in these units from the lane's **output end** (the
/// downstream edge of the tile), so a position lives in `0..TILE` and "forward"
/// *decreases* it.
pub const TILE: u32 = 256;

/// The minimum centre-to-centre distance between two items on the same lane
/// (= `TILE / 4`, i.e. four items per tile per lane). Belt movement may never
/// bring two items closer than this; the only thing that can is a *forced*
/// insertion (an inserter, a source, or side-loading) into a gap strictly larger
/// than `SPACING`, which squashes momentarily and relaxes back on the next move.
pub const SPACING: u32 = 64;

/// Per-distinct-item capacity of an assembler's input buffer.
pub const INPUT_CAP: u16 = 8;

/// Per-distinct-item capacity of an assembler's output buffer.
pub const OUTPUT_CAP: u16 = 8;

/// A belt tier: how many position units an unobstructed item on this belt
/// advances per tick (`SPEED`). A faster tier has a larger `SPEED`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BeltTier {
    /// The tier name as it appears in a scenario (`"slow"`, `"fast"`,
    /// `"express"`).
    pub name: &'static str,
    /// Units advanced per tick by an unobstructed item.
    pub speed: u32,
}

/// The **reference** belt speed, in position units advanced per tick by an
/// unobstructed item — the middle (`fast`) tier's speed, and the rate the inserter is
/// tuned to. At `TILE = 256` this crosses one tile in four ticks, and
/// [`INSERTER_SWING`] is set to match it, so an item carried in a claw moves at the
/// same linear speed as one riding a `fast` belt.
pub const BELT_SPEED: u32 = 64;

/// The belt tiers, in declaration order, each with its own speed: an upgrade tier
/// moves items proportionally faster (the Factorio-faithful 1×/2×/3× progression).
/// `slow` crosses a tile in eight ticks, `fast` in four, `express` in ~2.7 — so a
/// higher-tier belt is genuinely more throughput, not just a recolour. The
/// simulation already honours per-tile speed (see [`crate::tick`]), so mixed-tier
/// lines move at mixed rates; the tier a scenario names selects the speed here.
pub const BELT_TIERS: &[BeltTier] = &[
    BeltTier {
        name: "slow",
        speed: 32,
    },
    BeltTier {
        name: "fast",
        speed: BELT_SPEED,
    },
    BeltTier {
        name: "express",
        speed: 96,
    },
];

/// Look up a belt tier's `SPEED` by name. Returns `None` for an unknown tier (a
/// scenario validation error).
pub fn belt_speed(name: &str) -> Option<u32> {
    BELT_TIERS.iter().find(|t| t.name == name).map(|t| t.speed)
}

/// Ticks an inserter holds an item between pickup and drop.
///
/// There is exactly **one** kind of inserter, so this is a single constant
/// rather than a tier table: every inserter in the world swings at the same
/// rate, independent of where it sits or which belts it touches. (v1 briefly
/// had `base`/`fast` tiers, but a tier only makes sense once there is more than
/// one inserter *entity* to choose between; a lone entity with a speed knob just
/// made otherwise-identical inserters run at visibly different rates.)
///
/// Its value is tied to [`BELT_SPEED`] so an inserter carries an item at the **same
/// linear speed** a belt moves it. An inserter spans two tiles (it picks from the
/// tile behind and drops on the tile in front), and a belt crosses one tile in
/// `TILE / BELT_SPEED` ticks, so matching the speed gives
/// `2 * TILE / BELT_SPEED = 512 / 64 = 8`.
pub const INSERTER_SWING: u16 = (2 * TILE / BELT_SPEED) as u16;

/// The complete set of item ids v1 uses, in their **stable index order**. The
/// index (the position in this slice) is part of the canonical-bytes contract:
/// items are serialized as their `u16` index, not their string, so the bytes are
/// language- and format-independent. Never reorder this slice without bumping the
/// case version — it would change every checksum.
pub const ITEMS: &[&str] = &[
    "iron-ore",     // 0
    "iron-plate",   // 1
    "iron-gear",    // 2
    "copper-ore",   // 3
    "copper-plate", // 4
    "copper-cable", // 5
    "circuit",      // 6
    // The craftable machines. A factory assembles these from the intermediates
    // above and ships them to a sink, the way it ships any other product. Each is a
    // distinct item so a belt/inserter/assembler stream is a first-class good, not a
    // re-use of an intermediate. The three tiers per machine mirror the three belt
    // tiers (`slow`/`fast`/`express`); v1 ships a recipe only for the tier-1 item of
    // each, but all nine ids are pinned so the renderer's item sheet
    // (`lattice-items`, frames 7-15) and the canonical byte indices stay fixed as
    // the higher tiers gain recipes. **Never reorder or remove** — like the seven
    // above, the index is the checksum contract.
    "transport-belt",         // 7
    "fast-transport-belt",    // 8
    "express-transport-belt", // 9
    "assembler",              // 10
    "fast-assembler",         // 11
    "express-assembler",      // 12
    "inserter",               // 13
    "fast-inserter",          // 14
    "express-inserter",       // 15
];

/// The stable numeric index of an item id, or `None` if the id is not a known
/// item. This index is the value written to the canonical byte stream.
pub fn item_index(id: &str) -> Option<u16> {
    ITEMS.iter().position(|i| *i == id).map(|i| i as u16)
}

/// The item id for a stable index (the inverse of [`item_index`]).
pub fn item_name(index: u16) -> Option<&'static str> {
    ITEMS.get(index as usize).copied()
}

/// One input or output term of a recipe: an item and a count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecipeTerm {
    /// The item id.
    pub item: &'static str,
    /// How many of it the term consumes (input) or produces (output) per craft.
    pub count: u16,
}

/// A crafting recipe: a set of input terms, a set of output terms, and the tick
/// cost of one craft. Multi-output recipes are representable; v1 ships only the
/// single-output ones below.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Recipe {
    /// The recipe name as it appears in a scenario (`"iron-gear"`).
    pub name: &'static str,
    /// The items (and counts) consumed per craft.
    pub inputs: &'static [RecipeTerm],
    /// The items (and counts) produced per craft.
    pub outputs: &'static [RecipeTerm],
    /// Ticks one craft takes from start (inputs consumed) to finish (outputs
    /// deposited).
    pub craft: u16,
}

/// The recipe table, in declaration order.
pub const RECIPES: &[Recipe] = &[
    Recipe {
        name: "iron-plate",
        inputs: &[RecipeTerm {
            item: "iron-ore",
            count: 1,
        }],
        outputs: &[RecipeTerm {
            item: "iron-plate",
            count: 1,
        }],
        craft: 32,
    },
    Recipe {
        name: "copper-plate",
        inputs: &[RecipeTerm {
            item: "copper-ore",
            count: 1,
        }],
        outputs: &[RecipeTerm {
            item: "copper-plate",
            count: 1,
        }],
        craft: 32,
    },
    Recipe {
        name: "iron-gear",
        inputs: &[RecipeTerm {
            item: "iron-plate",
            count: 2,
        }],
        outputs: &[RecipeTerm {
            item: "iron-gear",
            count: 1,
        }],
        craft: 64,
    },
    Recipe {
        name: "copper-cable",
        inputs: &[RecipeTerm {
            item: "copper-plate",
            count: 1,
        }],
        outputs: &[RecipeTerm {
            item: "copper-cable",
            count: 2,
        }],
        craft: 32,
    },
    Recipe {
        name: "circuit",
        inputs: &[
            RecipeTerm {
                item: "iron-plate",
                count: 1,
            },
            RecipeTerm {
                item: "copper-cable",
                count: 3,
            },
        ],
        outputs: &[RecipeTerm {
            item: "circuit",
            count: 1,
        }],
        craft: 96,
    },
    // The three machine recipes. Each takes a UNIQUE combination of two or three of
    // the intermediates — not all of them — so a factory that builds machines has to
    // route several distinct component streams together rather than run one long
    // single-item line. The craft times all divide `LCM(32, 64, 96) = 192`, so the
    // steady-state cycle stays the same tiny 192 the transport reference detects (a
    // craft time coprime to that would push the cycle past its search window; see
    // the generator's `BUS_PERIOD`).
    //
    // The machines form a dependency tree, so building them routes intermediates
    // *forward into other machines* rather than only draining to sinks. A belt is
    // the cheap mechanical machine (iron only): plate + gear, two per craft like the
    // cable. An inserter adds the electronics but no plate body, consuming a gear and
    // a circuit directly. An assembler is the top of the tree: it consumes a
    // **transport-belt** (a machine feeding a machine — a belt frame) and a control
    // circuit, so a factory that builds assemblers must first build belts to feed
    // them.
    Recipe {
        name: "transport-belt",
        inputs: &[
            RecipeTerm {
                item: "iron-plate",
                count: 1,
            },
            RecipeTerm {
                item: "iron-gear",
                count: 1,
            },
        ],
        outputs: &[RecipeTerm {
            item: "transport-belt",
            count: 2,
        }],
        craft: 48,
    },
    Recipe {
        name: "inserter",
        inputs: &[
            RecipeTerm {
                item: "iron-gear",
                count: 1,
            },
            RecipeTerm {
                item: "circuit",
                count: 1,
            },
        ],
        outputs: &[RecipeTerm {
            item: "inserter",
            count: 1,
        }],
        craft: 64,
    },
    Recipe {
        name: "assembler",
        inputs: &[
            RecipeTerm {
                item: "transport-belt",
                count: 2,
            },
            RecipeTerm {
                item: "circuit",
                count: 1,
            },
        ],
        outputs: &[RecipeTerm {
            item: "assembler",
            count: 1,
        }],
        craft: 96,
    },
];

/// Look up a recipe by name. Returns `None` for an unknown recipe.
pub fn recipe(name: &str) -> Option<&'static Recipe> {
    RECIPES.iter().find(|r| r.name == name)
}

#[cfg(test)]
#[path = "prototypes.test.rs"]
mod tests;
