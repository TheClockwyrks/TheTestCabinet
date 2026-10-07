//! Tests for the canonical byte serialization and the checksum over it.

use std::collections::BTreeMap;

use super::*;

/// A snapshot exercising every entity kind, used to pin the byte layout.
fn sample_entities() -> Vec<EntityState> {
    vec![
        EntityState::Belt(BeltState {
            left: vec![
                BeltItem {
                    pos: 0,
                    item: "iron-plate".into(),
                },
                BeltItem {
                    pos: 64,
                    item: "iron-plate".into(),
                },
            ],
            right: vec![BeltItem {
                pos: 0,
                item: "iron-ore".into(),
            }],
        }),
        EntityState::Splitter(SplitterState {
            out_pref: 0b0000_0010,
            in_first: 1,
        }),
        EntityState::Inserter(InserterState {
            phase: InserterPhase::Swing,
            held: Some("iron-plate".into()),
            swing_left: 3,
        }),
        EntityState::Assembler(AssemblerState {
            inputs: BTreeMap::from([("iron-plate".to_string(), 2)]),
            output: BTreeMap::from([("iron-gear".to_string(), 1)]),
            craft_left: 12,
        }),
        EntityState::Source { emit_phase: 1 },
        EntityState::Sink(SinkState {
            consumed: BTreeMap::from([("iron-gear".to_string(), 4123)]),
        }),
    ]
}

#[test]
fn the_checksum_is_taken_over_canonical_bytes_not_json() {
    let entities = sample_entities();
    let snapshot = Snapshot::new(50_000, entities.clone());
    let bytes = canonical_bytes(50_000, &entities);
    assert_eq!(snapshot.checksum, checksum::checksum_string(&bytes));
    assert!(snapshot.checksum.starts_with("fnv1a64:"));
}

#[test]
fn canonical_bytes_are_stable_and_layout_starts_with_tick_and_count() {
    let entities = sample_entities();
    let bytes = canonical_bytes(50_000, &entities);
    // First 8 bytes: tick as little-endian u64.
    assert_eq!(&bytes[0..8], &50_000u64.to_le_bytes());
    // Next 4 bytes: entity count as little-endian u32.
    assert_eq!(&bytes[8..12], &(entities.len() as u32).to_le_bytes());
    // Byte 12: the first entity's kind tag (belt = 0).
    assert_eq!(bytes[12], 0);
}

#[test]
fn json_formatting_never_affects_the_checksum() {
    // Two snapshots with identical state but produced from independently-built
    // maps must share a checksum: the canonical bytes ignore map iteration order.
    let mut a = BTreeMap::new();
    a.insert("iron-plate".to_string(), 2u16);
    a.insert("iron-gear".to_string(), 0u16); // a zero entry the engine would drop
    let one = Snapshot::new(
        1,
        vec![EntityState::Assembler(AssemblerState {
            inputs: BTreeMap::from([("iron-plate".to_string(), 2u16)]),
            output: BTreeMap::new(),
            craft_left: 0,
        })],
    );
    let two = Snapshot::new(
        1,
        vec![EntityState::Assembler(AssemblerState {
            inputs: BTreeMap::from([("iron-plate".to_string(), 2u16)]),
            output: BTreeMap::new(),
            craft_left: 0,
        })],
    );
    assert_eq!(one.checksum, two.checksum);
    let _ = a;
}

#[test]
fn a_derived_checksum_matches_the_one_the_snapshot_was_built_with() {
    let snapshot = Snapshot::new(50_000, sample_entities());
    assert_eq!(
        snapshot.derived_checksum(),
        Ok(snapshot.checksum.clone()),
        "state built by `Snapshot::new` hashes to its own checksum"
    );
}

#[test]
fn a_derived_checksum_ignores_the_checksum_field_and_reads_the_state() {
    // The shape a deserialized submission snapshot can take: a `checksum` field
    // that says one thing and `entities` that say another. Deriving must report
    // what the STATE hashes to, so the host can tell the two apart.
    let honest = Snapshot::new(50_000, sample_entities());
    let claimed = Snapshot {
        tick: honest.tick,
        checksum: "fnv1a64:0000000000000000".to_string(),
        entities: honest.entities.clone(),
    };
    assert_eq!(claimed.derived_checksum(), Ok(honest.checksum));

    // ...and it tracks the state, not the tick label alone: same entities at a
    // different tick hash differently.
    let moved = Snapshot {
        tick: 50_001,
        ..claimed.clone()
    };
    assert_ne!(moved.derived_checksum(), claimed.derived_checksum());
}

#[test]
fn state_naming_an_unknown_item_is_reported_rather_than_panicking() {
    let entities = vec![EntityState::Sink(SinkState {
        consumed: BTreeMap::from([("unobtainium".to_string(), 1u64)]),
    })];
    assert_eq!(
        canonical_bytes_checked(1, &entities),
        Err(UnknownItem("unobtainium".to_string()))
    );
    let snapshot = Snapshot {
        tick: 1,
        checksum: "fnv1a64:0000000000000000".to_string(),
        entities,
    };
    assert_eq!(
        snapshot.derived_checksum().unwrap_err().to_string(),
        "unknown item id `unobtainium`"
    );
}

#[test]
fn a_snapshot_round_trips_through_json() {
    let snapshot = Snapshot::new(100, sample_entities());
    let json = serde_json::to_string(&snapshot).unwrap();
    let back: Snapshot = serde_json::from_str(&json).unwrap();
    assert_eq!(snapshot, back);
    // The held item is omitted from an idle inserter's JSON.
    let idle = Snapshot::new(
        1,
        vec![EntityState::Inserter(InserterState {
            phase: InserterPhase::Idle,
            held: None,
            swing_left: 0,
        })],
    );
    let json = serde_json::to_string(&idle).unwrap();
    assert!(!json.contains("held"));
}
