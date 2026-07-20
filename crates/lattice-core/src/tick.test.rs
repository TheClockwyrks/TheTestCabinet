//! Behaviour tests for the one-tick advance — the tricky cases the
//! [references doc](apps/docs/.../references.md) calls out: a single side-loaded
//! lane, a backed-up inserter, a saturated splitter, an assembler starved then
//! flooded, compaction relax-back, and source stall.
//!
//! Each test builds a small scenario, advances the world tick by tick, and reads
//! the live machine state directly so positions, buffers, and phases can be
//! asserted exactly.

use crate::prototypes::{SPACING, TILE, item_index};
use crate::scenario::Scenario;
use crate::world::{LaneItem, LaneSide, Machine, World};

/// Build a live world from scenario JSON.
fn world(json: &str) -> World {
    World::new(&Scenario::parse(json.as_bytes()).expect("valid test scenario"))
}

/// The left/right lanes of belt at machine index `i`.
fn belt_lanes(w: &World, i: usize) -> (Vec<LaneItem>, Vec<LaneItem>) {
    match &w.machines[i] {
        Machine::Belt(b) => (b.lanes[0].clone(), b.lanes[1].clone()),
        _ => panic!("machine {i} is not a belt"),
    }
}

// ---------------------------------------------------------------------------
// Compaction & relax-back.
// ---------------------------------------------------------------------------

#[test]
fn an_unobstructed_item_advances_by_speed_each_tick() {
    // A fast belt (SPEED 64): a single item rolls forward by 64 units a tick
    // until it reaches the output edge.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 4 }, "ticks": 10,
             "snapshots": [10],
             "entities": [ { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" } ] }"#,
    );
    if let Machine::Belt(b) = &mut w.machines[0] {
        b.lanes[LaneSide::Left.index()].push(LaneItem {
            pos: 192,
            item: item_index("iron-ore").unwrap(),
        });
    }
    w.advance();
    assert_eq!(belt_lanes(&w, 0).0[0].pos, 128, "192 - 64 = 128");
    w.advance();
    assert_eq!(belt_lanes(&w, 0).0[0].pos, 64);
    w.advance();
    assert_eq!(belt_lanes(&w, 0).0[0].pos, 0, "clamped at the output edge");
    w.advance();
    assert_eq!(belt_lanes(&w, 0).0[0].pos, 0, "it cannot pass the edge");
}

#[test]
fn movement_relaxes_a_squashed_pair_back_to_standard_spacing() {
    // Two items placed closer than SPACING (a momentary squash, as a forced
    // insertion would produce). Belt movement may never make a sub-standard gap,
    // so the trailing item cannot close further — it relaxes back to exactly
    // SPACING as the lead rolls forward.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 4 }, "ticks": 10,
             "snapshots": [10],
             "entities": [ { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" } ] }"#,
    );
    let ore = item_index("iron-ore").unwrap();
    if let Machine::Belt(b) = &mut w.machines[0] {
        // Lead at 100, trailing at 140 — a gap of 40 < SPACING (64): squashed.
        b.lanes[LaneSide::Left.index()].push(LaneItem {
            pos: 100,
            item: ore,
        });
        b.lanes[LaneSide::Left.index()].push(LaneItem {
            pos: 140,
            item: ore,
        });
    }
    w.advance();
    let (left, _) = belt_lanes(&w, 0);
    // Lead: 100 - 64 = 36. Trailing clamped to lead + SPACING = 36 + 64 = 100
    // (it cannot move to 76, which would still be a 40-unit gap).
    assert_eq!(left[0].pos, 36);
    assert_eq!(left[1].pos, 100, "the gap relaxes to exactly SPACING");
    assert_eq!(left[1].pos - left[0].pos, SPACING);
}

// ---------------------------------------------------------------------------
// Source emission cadence & stall.
// ---------------------------------------------------------------------------

#[test]
fn a_source_fills_a_lane_to_standard_spacing_then_stalls_when_it_is_full() {
    // Source period 1 onto a dead-end fast belt. It emits at the input slot
    // (TILE - SPACING). The forcing rule admits a gap of exactly SPACING, so a
    // saturated lane packs to the full four items per tile — 0, 64, 128, 192 —
    // with no hole at the back. Only a genuinely occupied entry slot stalls it.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 4 }, "ticks": 20,
             "snapshots": [20],
             "entities": [
                { "type": "source", "x": 0, "y": 1, "dir": "E", "item": "iron-ore", "lane": "left", "period": 1 },
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" } ] }"#,
    );
    // Tick 1: first emit lands at TILE - SPACING = 192, then the belt moves it to
    // 128. (The belt is machine index 1; the source is index 0.)
    w.advance();
    assert_eq!(belt_lanes(&w, 1).0.len(), 1);
    assert_eq!(belt_lanes(&w, 1).0[0].pos, 128);
    // Tick 2: the entry slot's nearest item is at 128 — exactly SPACING away, so
    // the force lands. Both items then advance one step.
    w.advance();
    let (left, _) = belt_lanes(&w, 1);
    assert_eq!(left.len(), 2, "a gap of exactly SPACING accepts a forced item");
    assert_eq!(
        left.iter().map(|i| i.pos).collect::<Vec<_>>(),
        vec![64, 128]
    );
    // Ticks 3-4: the lane fills to every standard slot and holds there. The lead
    // item is pinned at the output edge (dead-end belt), so the whole packed run
    // is static.
    w.advance();
    w.advance();
    let (left, _) = belt_lanes(&w, 1);
    assert_eq!(
        left.iter().map(|i| i.pos).collect::<Vec<_>>(),
        vec![0, SPACING, 2 * SPACING, 3 * SPACING],
        "a saturated lane holds four items per tile, not three"
    );
    // Tick 5: the entry slot is now occupied outright, so the emission is dropped
    // and the lane is unchanged — a full belt is genuinely full.
    w.advance();
    let (left, _) = belt_lanes(&w, 1);
    assert_eq!(left.len(), 4, "the emission stalled on a full lane");
    assert_eq!(
        left.iter().map(|i| i.pos).collect::<Vec<_>>(),
        vec![0, SPACING, 2 * SPACING, 3 * SPACING],
        "a full belt is static tick over tick"
    );
}

// ---------------------------------------------------------------------------
// Side-loading — a single lane filled, the other untouched.
// ---------------------------------------------------------------------------

#[test]
fn side_loading_fills_one_lane_and_leaves_the_other_flowing() {
    // Belt A (S-facing) feeds the side of Belt B (E-facing) — a perpendicular
    // hand-off. Both of A's lanes merge onto B's single near lane; B's other lane
    // stays empty (a separate stream could flow there untouched).
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 8 }, "ticks": 20,
             "snapshots": [20],
             "entities": [
                { "type": "source", "x": 1, "y": 0, "dir": "S", "item": "iron-ore", "lane": "both", "period": 2 },
                { "type": "belt", "x": 1, "y": 1, "dir": "S", "tier": "fast" },
                { "type": "belt", "x": 1, "y": 2, "dir": "E", "tier": "fast" } ] }"#,
    );
    for _ in 0..12 {
        w.advance();
    }
    let (b_left, b_right) = belt_lanes(&w, 2);
    assert!(b_left.is_empty(), "the far lane of B is never touched");
    assert!(!b_right.is_empty(), "the side-loaded lane of B fills");
    // The filled lane is compacted to standard spacing.
    for pair in b_right.windows(2) {
        assert!(pair[1].pos - pair[0].pos >= SPACING);
    }
}

// ---------------------------------------------------------------------------
// Inserter: pickup / swing / drop, and a backed-up inserter holding.
// ---------------------------------------------------------------------------

#[test]
fn an_inserter_swings_an_item_and_holds_when_the_drop_is_blocked() {
    // Source -> Belt A; an inserter picks from A and drops into a sink. With no
    // sink (drop target absent) the inserter picks up, swings, and then holds the
    // item indefinitely because the drop cannot land.
    //
    //   Belt A at (1,1) E. Inserter at (3,1) facing E picks from (2,1) — but
    //   (2,1) is empty, so put A's output adjacent: inserter at (2,1) facing S,
    //   picks from (2,0)=Belt A, drops onto (2,2) which is a wall (nothing).
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 8 }, "ticks": 40,
             "snapshots": [40],
             "entities": [
                { "type": "source", "x": 0, "y": 0, "dir": "E", "item": "iron-ore", "lane": "both", "period": 2 },
                { "type": "belt", "x": 1, "y": 0, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 0, "dir": "E", "tier": "fast" },
                { "type": "inserter", "x": 2, "y": 1, "dir": "S", "tier": "base" } ] }"#,
    );
    // Run until items reach belt (2,0) and the inserter picks one up.
    let mut picked = false;
    for _ in 0..40 {
        w.advance();
        if let Machine::Inserter(ins) = &w.machines[3]
            && ins.held.is_some()
        {
            picked = true;
        }
    }
    assert!(
        picked,
        "the inserter eventually picks an item from the belt"
    );
    // The drop tile (2,2) holds no machine, so the held item is stuck: the
    // inserter ends still holding it (swing_left clamped at 1, retrying).
    if let Machine::Inserter(ins) = &w.machines[3] {
        assert!(ins.held.is_some(), "it holds, drop blocked");
        assert_eq!(ins.swing_left, 1, "a blocked drop retries each tick");
    }
}

#[test]
fn an_inserter_moves_items_from_a_belt_into_a_sink() {
    // Belt A (E) -> inserter (facing S) -> sink. The inserter should accumulate
    // consumed items in the sink over time.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 8 }, "ticks": 60,
             "snapshots": [60],
             "entities": [
                { "type": "source", "x": 0, "y": 0, "dir": "E", "item": "iron-ore", "lane": "left", "period": 4 },
                { "type": "belt", "x": 1, "y": 0, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 0, "dir": "E", "tier": "fast" },
                { "type": "inserter", "x": 2, "y": 1, "dir": "S", "tier": "base" },
                { "type": "sink", "x": 2, "y": 2, "dir": "N" } ] }"#,
    );
    for _ in 0..60 {
        w.advance();
    }
    let Machine::Sink(sink) = &w.machines[4] else {
        panic!("entity 4 is the sink");
    };
    let total: u64 = sink.consumed.values().copied().sum();
    assert!(total > 0, "the inserter delivered items into the sink");
}

// ---------------------------------------------------------------------------
// Splitter: round-robin balancing of a saturated input.
// ---------------------------------------------------------------------------

#[test]
fn a_saturated_splitter_balances_across_both_outputs() {
    // One input belt feeding a splitter with two output belts each draining into a
    // sink. A saturated single input should split roughly evenly across the two
    // outputs via round-robin.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 16, "height": 8 }, "ticks": 400,
             "snapshots": [400],
             "entities": [
                { "type": "source", "x": 0, "y": 1, "dir": "E", "item": "iron-ore", "lane": "left", "period": 2 },
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "splitter", "x": 2, "y": 1, "dir": "E" },
                { "type": "belt", "x": 3, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 3, "y": 2, "dir": "E", "tier": "fast" },
                { "type": "sink", "x": 4, "y": 1, "dir": "W" },
                { "type": "sink", "x": 4, "y": 2, "dir": "W" } ] }"#,
    );
    for _ in 0..400 {
        w.advance();
    }
    let total = |i: usize| -> u64 {
        match &w.machines[i] {
            Machine::Sink(s) => s.consumed.values().copied().sum(),
            _ => 0,
        }
    };
    let a = total(5);
    let b = total(6);
    assert!(a > 0 && b > 0, "both outputs received items (a={a} b={b})");
    let diff = a.abs_diff(b);
    assert!(
        diff <= 2,
        "round-robin keeps the two outputs balanced (a={a} b={b})"
    );
}

#[test]
fn a_splitter_spreads_a_single_input_lane_across_all_four_output_lanes() {
    // A splitter balances lanes as well as belts: an input arriving on the LEFT
    // lane only must come out spread over both lanes of both output belts. (The
    // input lane used to be preserved, which left the two right-hand output lanes
    // permanently empty and halved a balanced line's usable throughput.)
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 16, "height": 8 }, "ticks": 400,
             "snapshots": [400],
             "entities": [
                { "type": "source", "x": 0, "y": 1, "dir": "E", "item": "iron-ore", "lane": "left", "period": 1 },
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "splitter", "x": 2, "y": 1, "dir": "E" },
                { "type": "belt", "x": 3, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 3, "y": 2, "dir": "E", "tier": "fast" } ] }"#,
    );
    for _ in 0..400 {
        w.advance();
    }
    // The input belt only ever carries a left-lane stream.
    let (in_left, in_right) = belt_lanes(&w, 1);
    assert!(!in_left.is_empty(), "the input lane is fed");
    assert!(in_right.is_empty(), "the source never fills the right lane");

    // Both dead-end output belts should be saturated on BOTH lanes.
    for belt in [3usize, 4] {
        let (left, right) = belt_lanes(&w, belt);
        assert_eq!(
            left.len(),
            4,
            "output belt {belt} left lane is saturated (got {left:?})"
        );
        assert_eq!(
            right.len(),
            4,
            "output belt {belt} right lane is saturated (got {right:?})"
        );
    }
}

#[test]
fn a_splitter_with_one_output_belt_sends_everything_to_it() {
    // A splitter whose second output tile holds no belt must route the whole flow to
    // the belt it does have. Treating the empty side as back pressure deadlocked it:
    // a stall does not advance the round-robin cursor, so once the cursor landed on
    // the empty side every later tick chose it again and pushed the item back. The
    // splitter passed exactly one item and then jammed forever.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 16, "height": 8 }, "ticks": 400,
             "snapshots": [400],
             "entities": [
                { "type": "source", "x": 0, "y": 1, "dir": "E", "item": "iron-ore", "lane": "left", "period": 2 },
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "splitter", "x": 2, "y": 1, "dir": "E" },
                { "type": "belt", "x": 3, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "sink", "x": 4, "y": 1, "dir": "W" } ] }"#,
    );
    for _ in 0..400 {
        w.advance();
    }
    let Machine::Sink(sink) = &w.machines[4] else {
        panic!("entity 4 is the sink");
    };
    let total: u64 = sink.consumed.values().copied().sum();
    assert!(
        total > 100,
        "the whole flow reaches the single output belt (got {total}); \
         a deadlocked splitter passes about one item"
    );
}

#[test]
fn a_splitter_with_no_output_belts_holds_its_items() {
    // The other end of the same rule: skipping an absent output must not turn into
    // an item sink. With neither output present there is nowhere to push, so the
    // items stay on the input belt rather than vanishing.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 16, "height": 8 }, "ticks": 200,
             "snapshots": [200],
             "entities": [
                { "type": "source", "x": 0, "y": 1, "dir": "E", "item": "iron-ore", "lane": "left", "period": 2 },
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "splitter", "x": 2, "y": 1, "dir": "E" } ] }"#,
    );
    for _ in 0..200 {
        w.advance();
    }
    let Machine::Belt(belt) = &w.machines[1] else {
        panic!("entity 1 is the feeding belt");
    };
    let held: usize = belt.lanes.iter().map(|lane| lane.len()).sum();
    assert!(
        held > 0,
        "items back up on the input belt rather than being consumed by a splitter \
         with nowhere to put them"
    );
}

// ---------------------------------------------------------------------------
// Assembler: starved then flooded, with pause-when-output-full.
// ---------------------------------------------------------------------------

#[test]
fn a_starved_assembler_is_idle_then_crafts_once_fed() {
    // An iron-plate assembler (iron-ore -> iron-plate, 32 ticks). Starved, it sits
    // idle; once its input buffer holds a set it consumes and counts down.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 8 }, "ticks": 200,
             "snapshots": [200],
             "entities": [
                { "type": "assembler", "x": 1, "y": 1, "recipe": "iron-plate" } ] }"#,
    );
    let ore = item_index("iron-ore").unwrap();
    // Starved: idle.
    w.advance();
    if let Machine::Assembler(a) = &w.machines[0] {
        assert_eq!(a.craft_left, 0, "no inputs -> idle");
    }
    // Feed one ore into the input buffer, then advance: it starts a craft.
    if let Machine::Assembler(a) = &mut w.machines[0] {
        a.inputs.insert(ore, 1);
    }
    w.advance();
    if let Machine::Assembler(a) = &w.machines[0] {
        assert_eq!(
            a.craft_left, 32,
            "a fed assembler starts the CRAFT countdown"
        );
        assert_eq!(
            a.inputs.get(&ore).copied().unwrap_or(0),
            0,
            "one set consumed at start"
        );
    }
    // Run the craft out: after 32 ticks total the output appears.
    for _ in 0..32 {
        w.advance();
    }
    let plate = item_index("iron-plate").unwrap();
    if let Machine::Assembler(a) = &w.machines[0] {
        assert!(
            a.output.get(&plate).copied().unwrap_or(0) >= 1,
            "it deposited a plate"
        );
    }
}

#[test]
fn an_assembler_pauses_when_its_output_buffer_is_full() {
    // Flood the input buffer and fill the output buffer to OUTPUT_CAP: the
    // assembler must NOT start a new craft (it pauses rather than overflow), so it
    // stops consuming inputs.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 8 }, "ticks": 200,
             "snapshots": [200],
             "entities": [
                { "type": "assembler", "x": 1, "y": 1, "recipe": "iron-plate" } ] }"#,
    );
    let ore = item_index("iron-ore").unwrap();
    let plate = item_index("iron-plate").unwrap();
    if let Machine::Assembler(a) = &mut w.machines[0] {
        a.inputs.insert(ore, 8); // flooded inputs
        a.output.insert(plate, crate::prototypes::OUTPUT_CAP); // full output
    }
    w.advance();
    if let Machine::Assembler(a) = &w.machines[0] {
        assert_eq!(a.craft_left, 0, "a full output pauses the assembler");
        assert_eq!(
            a.inputs.get(&ore).copied().unwrap_or(0),
            8,
            "it stops consuming inputs"
        );
    }
}

// ---------------------------------------------------------------------------
// End-feeding preserves lanes across a straight join.
// ---------------------------------------------------------------------------

#[test]
fn end_feeding_keeps_an_item_on_the_same_lane() {
    // Two collinear E belts. An item on the left lane of the upstream belt arrives
    // on the left lane of the downstream belt (lanes stay separate).
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 4 }, "ticks": 20,
             "snapshots": [20],
             "entities": [
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 1, "dir": "E", "tier": "fast" } ] }"#,
    );
    let ore = item_index("iron-ore").unwrap();
    if let Machine::Belt(b) = &mut w.machines[0] {
        b.lanes[LaneSide::Left.index()].push(LaneItem { pos: 0, item: ore });
    }
    // One tick: the lead item at the output edge hands off to the downstream belt.
    w.advance();
    let (down_left, down_right) = belt_lanes(&w, 1);
    assert_eq!(down_left.len(), 1, "it arrived on the downstream LEFT lane");
    assert!(down_right.is_empty(), "the right lane stays empty");
    assert_eq!(
        down_left[0].pos,
        TILE - SPACING,
        "it enters at the standard input slot"
    );
}
