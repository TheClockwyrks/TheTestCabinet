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
// Runs: rigid-block movement and seamless tile crossings.
// ---------------------------------------------------------------------------

#[test]
fn an_item_crosses_a_tile_boundary_by_exactly_one_speed_step() {
    // Two collinear fast belts form one run. An item at the output edge of the
    // upstream tile is one step from the seam; after a tick it is on the
    // downstream tile at `TILE - SPEED`, i.e. it advanced exactly SPEED units of
    // world travel — no skip, no double step across the boundary.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 4 }, "ticks": 10,
             "snapshots": [10],
             "entities": [
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 1, "dir": "E", "tier": "fast" } ] }"#,
    );
    // Place the item on the UPSTREAM belt (x=1, machine 0) at its output edge.
    if let Machine::Belt(b) = &mut w.machines[0] {
        b.lanes[LaneSide::Left.index()].push(LaneItem {
            pos: 0,
            item: item_index("iron-ore").unwrap(),
        });
    }
    w.advance();
    // It has crossed onto the downstream belt (x=2, machine 1), one SPEED in.
    assert!(belt_lanes(&w, 0).0.is_empty(), "left the upstream tile");
    let (down, _) = belt_lanes(&w, 1);
    assert_eq!(down.len(), 1, "arrived on the downstream tile");
    assert_eq!(
        down[0].pos,
        TILE - 64,
        "crossed the seam by exactly one SPEED step (64), not a fixed SPACING jump"
    );
}

#[test]
fn a_packed_run_moves_as_a_rigid_block_when_its_front_is_freed() {
    // A three-tile run packed to standard spacing on every tile. Freeing the lead
    // item (as a sink or inserter would) must shift the WHOLE run forward one slot
    // in a single tick — every tile stays packed and the freed slot appears only
    // at the very back — rather than a hole crawling backward one tile per tick.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 4 }, "ticks": 10,
             "snapshots": [10],
             "entities": [
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 3, "y": 1, "dir": "E", "tier": "fast" } ] }"#,
    );
    let ore = item_index("iron-ore").unwrap();
    // Pack every tile: 0, 64, 128, 192 on the left lane of each of the 3 belts.
    for m in 0..3 {
        if let Machine::Belt(b) = &mut w.machines[m] {
            for pos in [0, SPACING, 2 * SPACING, 3 * SPACING] {
                b.lanes[LaneSide::Left.index()].push(LaneItem { pos, item: ore });
            }
        }
    }
    // The most-downstream belt (x=3, machine 2) faces empty space, so its lead is
    // pinned at the edge and nothing moves — the packed run is frozen.
    w.advance();
    for m in 0..3 {
        assert_eq!(
            belt_lanes(&w, m)
                .0
                .iter()
                .map(|i| i.pos)
                .collect::<Vec<_>>(),
            vec![0, SPACING, 2 * SPACING, 3 * SPACING],
            "a blocked packed run is completely static (belt {m})"
        );
    }
    // Now free the lead of the most-downstream belt (as a consumer would) and
    // advance: the whole run shifts one slot, staying packed, with the hole at the
    // very back of the most-upstream belt only.
    if let Machine::Belt(b) = &mut w.machines[2] {
        b.lanes[LaneSide::Left.index()].remove(0);
    }
    w.advance();
    let packed = vec![0, SPACING, 2 * SPACING, 3 * SPACING];
    assert_eq!(
        belt_lanes(&w, 2)
            .0
            .iter()
            .map(|i| i.pos)
            .collect::<Vec<_>>(),
        packed,
        "downstream tile re-packed in one tick"
    );
    assert_eq!(
        belt_lanes(&w, 1)
            .0
            .iter()
            .map(|i| i.pos)
            .collect::<Vec<_>>(),
        packed,
        "middle tile stayed packed — no backward hole"
    );
    assert_eq!(
        belt_lanes(&w, 0)
            .0
            .iter()
            .map(|i| i.pos)
            .collect::<Vec<_>>(),
        vec![0, SPACING, 2 * SPACING],
        "the freed slot appears only at the very back of the run"
    );
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
    assert_eq!(
        left.len(),
        2,
        "a gap of exactly SPACING accepts a forced item"
    );
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
// Curves vs side-loading. A pure curve (sole perpendicular feeder) continues the
// run and carries BOTH lanes through the 90° turn, preserved. A genuine side-load
// (a belt with its own straight feed plus a perpendicular feeder) forces the
// feeder's lead onto one near lane and leaves the other for the straight flow.
// ---------------------------------------------------------------------------

#[test]
fn a_curve_carries_both_lanes_through_the_turn() {
    // Belt A (S-facing) bends into Belt B (E-facing): a PURE CURVE — B's only feeder
    // is the perpendicular A, so B continues A's run. Both of A's lanes carry through
    // the 90° turn PRESERVED (left stays left, right stays right) at belt speed,
    // exactly like a straight belt — NOT a side-load that dumps both into one near
    // lane. So BOTH of B's lanes fill.
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
    assert!(
        !b_left.is_empty(),
        "the curve carries the left lane through"
    );
    assert!(
        !b_right.is_empty(),
        "the curve carries the right lane through too — both lanes are preserved"
    );
    // Each lane stays compacted to standard spacing, just as on a straight belt.
    for lane in [&b_left, &b_right] {
        for pair in lane.windows(2) {
            assert!(pair[1].pos - pair[0].pos >= SPACING);
        }
    }
}

#[test]
fn a_side_load_fills_the_near_lane_and_leaves_the_far_lane_flowing() {
    // A GENUINE side-load (not a curve): belt B (E-facing) has its OWN straight feed
    // from the west (so it is not a pure curve) AND a perpendicular feeder from the
    // north. The north feeder forces its lead onto B's NEAR lane = its north lane =
    // LEFT (the side the feeder is on); both of the feeder's lanes land on that one
    // near lane (each at its own contact point, see the next test), and B's far
    // (right/south) lane is left for its straight flow — which here is empty, so the
    // far lane stays empty. A feeder from the south fills the right lane instead.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 8 }, "ticks": 20,
             "snapshots": [20],
             "entities": [
                { "type": "belt", "x": 0, "y": 2, "dir": "E", "tier": "fast" },
                { "type": "source", "x": 1, "y": 0, "dir": "S", "item": "iron-ore", "lane": "both", "period": 2 },
                { "type": "belt", "x": 1, "y": 1, "dir": "S", "tier": "fast" },
                { "type": "belt", "x": 1, "y": 2, "dir": "E", "tier": "fast" } ] }"#,
    );
    for _ in 0..12 {
        w.advance();
    }
    let (b_left, b_right) = belt_lanes(&w, 3);
    assert!(b_right.is_empty(), "the far lane of B is never touched");
    assert!(
        !b_left.is_empty(),
        "the side-loaded near (left) lane of B fills"
    );
    for pair in b_left.windows(2) {
        assert!(pair[1].pos - pair[0].pos >= SPACING);
    }
}

#[test]
fn a_side_load_places_each_feeder_lane_at_its_own_contact_point() {
    // Both feeder lanes cross onto the target's near lane, but at DIFFERENT positions
    // reflecting where each physically makes contact: the lane that is UPSTREAM in the
    // target's flow enters near the input edge (`TILE/2 + SPACING`), the DOWNSTREAM lane
    // further along at its contact point (`TILE/2 - SPACING`). Onto an empty target both
    // land the SAME tick — the old "everything enters at TILE - SPACING" model could
    // place only one per tick and teleported the downstream item to the back.
    //
    //   B = belt (1,2) E, drained east by a sink so it stays clear between deliveries;
    //   an empty straight feed at (0,2) makes B a side-load target, not a pure curve;
    //   a period-8 source feeds both lanes of the perpendicular feeder (1,1) S.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 8 }, "ticks": 60,
             "snapshots": [60],
             "entities": [
                { "type": "belt", "x": 0, "y": 2, "dir": "E", "tier": "fast" },
                { "type": "source", "x": 1, "y": 0, "dir": "S", "item": "iron-ore", "lane": "both", "period": 8 },
                { "type": "belt", "x": 1, "y": 1, "dir": "S", "tier": "fast" },
                { "type": "belt", "x": 1, "y": 2, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 2, "dir": "E", "tier": "fast" },
                { "type": "sink", "x": 3, "y": 2, "dir": "W" } ] }"#,
    );
    // Some delivery tick lands both feeder lanes on B's near lane at once, at exactly
    // the two contact coordinates — never both at the single back coordinate.
    let mut saw_both = false;
    for _ in 0..60 {
        w.advance();
        let (b_left, _) = belt_lanes(&w, 3);
        let at = |p: u32| b_left.iter().any(|it| it.pos == p);
        if at(TILE / 2 + SPACING) && at(TILE / 2 - SPACING) {
            saw_both = true;
            break;
        }
    }
    assert!(
        saw_both,
        "both feeder lanes land on the near lane at their own contact points \
         (TILE/2 + SPACING and TILE/2 - SPACING) in the same tick"
    );
}

// ---------------------------------------------------------------------------
// Inserter: pickup / swing / drop, and a backed-up inserter holding.
// ---------------------------------------------------------------------------

#[test]
fn an_inserter_waits_empty_when_it_can_never_deposit() {
    // Source -> Belt A; an inserter picks from A but its drop tile is a wall (no
    // machine). Under the wait-empty rule the inserter must NEVER pick up — grabbing
    // an item it could never deposit is exactly what the rule forbids — so it stays
    // idle with empty claws even as items keep arriving on the belt behind it.
    //
    //   Belts at (1,0),(2,0) run E, fed by a source. Inserter at (2,1) faces S: it
    //   would pick from (2,0)=Belt A and drop onto (2,2), which holds no machine.
    //
    // (An inserter holding an item over a full target now happens ONLY in the
    // two-inserter race — both peek room, both grab, one deposits and the other
    // stalls holding, via the unchanged drop-stall path — which the scenario suite
    // exercises. A lone inserter with an unreachable target simply waits.)
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 8 }, "ticks": 40,
             "snapshots": [40],
             "entities": [
                { "type": "source", "x": 0, "y": 0, "dir": "E", "item": "iron-ore", "lane": "both", "period": 2 },
                { "type": "belt", "x": 1, "y": 0, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 0, "dir": "E", "tier": "fast" },
                { "type": "inserter", "x": 2, "y": 1, "dir": "S" } ] }"#,
    );
    for _ in 0..40 {
        w.advance();
        if let Machine::Inserter(ins) = &w.machines[3] {
            assert!(
                ins.held.is_none(),
                "it waits empty; it never grabs an item it cannot deposit"
            );
            assert_eq!(ins.swing_left, 0, "no swing while idle");
        }
    }
    // The belt behind it did fill, so the inserter genuinely had items available and
    // deliberately left them rather than grabbing and stalling over the wall.
    let (left, right) = belt_lanes(&w, 2);
    assert!(
        !left.is_empty() || !right.is_empty(),
        "items were available to pick up"
    );
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

#[test]
fn an_inserter_swings_back_empty_before_grabbing_again() {
    // The empty return is real time, not instant. A busy inserter (belt -> sink, so
    // it can always deposit) spends `SWING` ticks empty-handed and mid-motion after
    // each drop — the `return` phase, held None with swing_left counting down — before
    // it is idle and can grab again. Before this, an empty inserter re-grabbed the very
    // next tick, so it never spent real time on the way back.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 4 }, "ticks": 80,
             "snapshots": [80],
             "entities": [
                { "type": "source", "x": 0, "y": 1, "dir": "E", "item": "iron-ore", "lane": "both", "period": 1 },
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "inserter", "x": 3, "y": 1, "dir": "E" },
                { "type": "sink", "x": 4, "y": 1, "dir": "E" } ] }"#,
    );
    let swing = crate::prototypes::INSERTER_SWING as usize;
    let mut seq = Vec::new();
    for _ in 0..80 {
        w.advance();
        if let Machine::Inserter(i) = &w.machines[3] {
            seq.push((i.held.is_some(), i.swing_left));
        }
    }
    // Empty-but-still-counting-down ticks are the return swing. There must be at least
    // one whole return's worth, and the arm must also actually carry items.
    let return_ticks = seq.iter().filter(|(held, sl)| !held && *sl > 0).count();
    assert!(
        return_ticks >= swing,
        "the inserter spends real time swinging back empty (>= SWING return ticks); got {return_ticks}"
    );
    assert!(
        seq.iter().any(|(held, _)| *held),
        "the inserter carries items"
    );
    // The longest empty-and-counting run is a full return, not a single idle tick.
    let mut longest = 0;
    let mut run = 0;
    for (held, sl) in &seq {
        if !held && *sl > 0 {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }
    assert!(
        longest >= swing,
        "one return runs the full SWING ticks; got {longest}"
    );
}

#[test]
fn an_inserter_takes_the_closer_lane_first() {
    // Both lanes of the pickup belt hold an item; the inserter takes the one on the lane
    // physically CLOSER to it and only reaches across to the other lane when the closer
    // one's head is empty. Subtlety: `near_far_lanes` names lanes by the inserter's
    // FACING, and an inserter picks from BEHIND itself, so the physically-closer lane is
    // the one it calls `far` — which `try_pickup` tries first. This pins the priority
    // down and guards against re-inverting the pickup order to `[near, far]`.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 6, "height": 6 }, "ticks": 10, "snapshots": [10],
             "entities": [
                { "type": "belt", "x": 2, "y": 2, "dir": "E", "tier": "fast" },
                { "type": "inserter", "x": 2, "y": 1, "dir": "N" },
                { "type": "sink", "x": 2, "y": 0, "dir": "N" } ] }"#,
    );
    // The inserter at (2,1) faces N: it sits NORTH of the belt at (2,2) and picks from
    // it, dropping into the sink ahead (always accepts) — so the only choice under test
    // is the lane. For an E belt the left lane is the north side (`left_offset(E)`), and
    // the inserter is north, so the LEFT lane is the closer one.
    let iron = item_index("iron-ore").unwrap();
    let copper = item_index("copper-ore").unwrap();
    let closer = LaneSide::Left; // north side == closer to the northern inserter
    let farther = LaneSide::Right;
    if let Machine::Belt(b) = &mut w.machines[0] {
        b.lanes[closer.index()] = vec![LaneItem { pos: 0, item: iron }];
        b.lanes[farther.index()] = vec![LaneItem {
            pos: 0,
            item: copper,
        }];
    }
    w.advance();
    // The idle inserter grabs on this tick: it must be holding the CLOSER (iron) item.
    let held = match &w.machines[1] {
        Machine::Inserter(i) => i.held,
        _ => panic!("entity 1 is the inserter"),
    };
    assert_eq!(
        held,
        Some(iron),
        "the inserter grabbed the physically closer lane's item, not the farther one"
    );
    // The farther lane's item is left behind for a later reach-across.
    let lanes = belt_lanes(&w, 0);
    assert!(
        lanes.1.iter().any(|i| i.item == copper),
        "only the closer item was taken; the farther-lane item remains on the belt"
    );
}

/// The inserter used by the crafter-pickup tests below: it sits at `(2,2)` facing
/// N, picks from the belt at `(2,3)` behind it, and drops into the crafter that
/// covers the tile `(2,1)` in front. For the E belt the north side is the LEFT lane
/// (`left_offset(E)`), and the inserter is north of the belt, so LEFT is the lane
/// physically CLOSER to it.
const CLOSER: LaneSide = LaneSide::Left;
const FARTHER: LaneSide = LaneSide::Right;

#[test]
fn an_inserter_fills_a_furnaces_fuel_before_its_ore() {
    // A furnace's inserter picks from a belt carrying ore on the CLOSER lane and coal
    // (the fuel) on the farther lane. Fuel comes first: the inserter reaches past the
    // closer ore to grab coal, so the fuel buffer fills before any ore is loaded. This
    // is the crafter-aware pickup overriding the plain closer-lane preference.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 5, "height": 5 }, "ticks": 50, "snapshots": [50],
             "entities": [
                { "type": "furnace", "x": 2, "y": 0, "recipe": "iron-plate" },
                { "type": "inserter", "x": 2, "y": 2, "dir": "N" },
                { "type": "belt", "x": 2, "y": 3, "dir": "E", "tier": "fast" } ] }"#,
    );
    let ore = item_index("iron-ore").unwrap();
    let coal = item_index("coal").unwrap();
    if let Machine::Belt(b) = &mut w.machines[2] {
        b.lanes[CLOSER.index()] = vec![LaneItem { pos: 0, item: ore }];
        b.lanes[FARTHER.index()] = vec![LaneItem { pos: 0, item: coal }];
    }
    w.advance();
    let held = match &w.machines[1] {
        Machine::Inserter(i) => i.held,
        _ => panic!("entity 1 is the inserter"),
    };
    assert_eq!(
        held,
        Some(coal),
        "the inserter grabbed the farther-lane fuel before the closer ore"
    );
}

#[test]
fn an_inserter_reaches_across_for_a_furnaces_missing_input() {
    // The user's case: the CLOSER lane carries coal, the farther lane ore, and the
    // furnace's fuel buffer is already full. The old rule stalled — it kept peeking the
    // full-buffer coal on the closer lane and never reached the ore. Now the inserter
    // reaches across and grabs the ore the furnace still needs.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 5, "height": 5 }, "ticks": 50, "snapshots": [50],
             "entities": [
                { "type": "furnace", "x": 2, "y": 0, "recipe": "iron-plate" },
                { "type": "inserter", "x": 2, "y": 2, "dir": "N" },
                { "type": "belt", "x": 2, "y": 3, "dir": "E", "tier": "fast" } ] }"#,
    );
    let ore = item_index("iron-ore").unwrap();
    let coal = item_index("coal").unwrap();
    // Fuel buffer full; no ore yet.
    if let Machine::Furnace(f) = &mut w.machines[0] {
        f.inputs.insert(coal, crate::prototypes::INPUT_CAP);
    }
    if let Machine::Belt(b) = &mut w.machines[2] {
        b.lanes[CLOSER.index()] = vec![LaneItem { pos: 0, item: coal }];
        b.lanes[FARTHER.index()] = vec![LaneItem { pos: 0, item: ore }];
    }
    w.advance();
    let held = match &w.machines[1] {
        Machine::Inserter(i) => i.held,
        _ => panic!("entity 1 is the inserter"),
    };
    assert_eq!(
        held,
        Some(ore),
        "with fuel full, the inserter reaches past the closer coal to the ore it still needs"
    );
    // The closer-lane coal is left on the belt — it was not grabbed and stalled.
    let (closer, _) = belt_lanes(&w, 2);
    assert!(
        closer.iter().any(|i| i.item == coal),
        "the un-needed closer coal stays on the belt"
    );
}

#[test]
fn an_inserter_switches_to_an_assemblers_missing_component() {
    // An assembler whose closer-lane component is already full: the inserter skips it
    // and grabs the farther-lane component the recipe is still short of, instead of
    // stalling on the full one.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 6, "height": 6 }, "ticks": 50, "snapshots": [50],
             "entities": [
                { "type": "assembler", "x": 2, "y": 0, "recipe": "circuit" },
                { "type": "inserter", "x": 2, "y": 3, "dir": "N" },
                { "type": "belt", "x": 2, "y": 4, "dir": "E", "tier": "fast" } ] }"#,
    );
    // `circuit` = iron-plate x1 + copper-cable x3. Fill the plate buffer; leave cable
    // empty.
    let plate = item_index("iron-plate").unwrap();
    let cable = item_index("copper-cable").unwrap();
    if let Machine::Assembler(a) = &mut w.machines[0] {
        a.inputs.insert(plate, crate::prototypes::INPUT_CAP);
    }
    if let Machine::Belt(b) = &mut w.machines[2] {
        b.lanes[CLOSER.index()] = vec![LaneItem {
            pos: 0,
            item: plate,
        }];
        b.lanes[FARTHER.index()] = vec![LaneItem {
            pos: 0,
            item: cable,
        }];
    }
    w.advance();
    let held = match &w.machines[1] {
        Machine::Inserter(i) => i.held,
        _ => panic!("entity 1 is the inserter"),
    };
    assert_eq!(
        held,
        Some(cable),
        "the inserter skipped the full closer component for the missing farther one"
    );
}

// ---------------------------------------------------------------------------
// Splitter: round-robin balancing of a saturated input.
// ---------------------------------------------------------------------------

#[test]
fn a_splitter_moves_both_input_lanes_on_the_same_tick() {
    // Two items sitting side by side at the output edge of ONE input belt (one on each
    // lane) must move on the SAME tick, not on two separate ticks. That is the whole
    // point of processing every input lane per tick: a saturated input no longer
    // staggers, and neither lane is starved while the other drains.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 6 }, "ticks": 10,
             "snapshots": [10],
             "entities": [
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "splitter", "x": 2, "y": 1, "dir": "E" },
                { "type": "belt", "x": 3, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 3, "y": 2, "dir": "E", "tier": "fast" } ] }"#,
    );
    let ore = item_index("iron-ore").unwrap();
    // A lead at the output edge (pos 0) on BOTH lanes of the single input belt.
    if let Machine::Belt(b) = &mut w.machines[0] {
        b.lanes[LaneSide::Left.index()].push(LaneItem { pos: 0, item: ore });
        b.lanes[LaneSide::Right.index()].push(LaneItem { pos: 0, item: ore });
    }
    w.advance();
    // After a single tick BOTH input lanes are empty — both were pulled together.
    let (left, right) = belt_lanes(&w, 0);
    assert!(
        left.is_empty() && right.is_empty(),
        "both input lanes move on the same tick (not staggered): left={left:?} right={right:?}"
    );
    // And both items are now on the outputs.
    let (o1l, o1r) = belt_lanes(&w, 2);
    let (o2l, o2r) = belt_lanes(&w, 3);
    assert_eq!(
        o1l.len() + o1r.len() + o2l.len() + o2r.len(),
        2,
        "both items landed on the outputs this tick"
    );
}

#[test]
fn a_saturated_splitter_balances_across_both_outputs() {
    // One input belt feeding a splitter with two output belts each draining into a
    // sink. A saturated single input should split roughly evenly across the two
    // outputs via the per-type alternation (same lane on each belt).
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
fn a_splitter_preserves_the_input_lane() {
    // The splitter moves items across BELTS, never across LANES: a stream arriving on
    // the LEFT lane only comes out on the LEFT lane of the output belts and never
    // crosses to a right lane. (A single left-lane stream splits across the two output
    // belts' left lanes, alternating; the right lanes stay empty.)
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

    // Both output belts carry the stream on the LEFT lane, and NEVER the right — the
    // input lane is preserved across the split.
    for belt in [3usize, 4] {
        let (left, right) = belt_lanes(&w, belt);
        assert!(
            !left.is_empty(),
            "output belt {belt} left lane carries the stream"
        );
        assert!(
            right.is_empty(),
            "output belt {belt} right lane stays empty — lane preserved (got {right:?})"
        );
    }
}

#[test]
fn a_splitter_balances_two_input_belts_across_both_outputs() {
    // Two full input belts of two DIFFERENT items — a top belt of iron on both lanes
    // and a bottom belt of copper on both lanes. The splitter is item-AGNOSTIC: it
    // balances by COUNT, not by type, so over the run it feeds each output belt an equal
    // share of the total flow. It does not sort by type per tick (a single tick may send
    // one output a row of iron and the other a row of copper), but across the run both
    // output belts end up carrying BOTH iron and copper — not one belt all iron and the
    // other all copper forever. Lanes are still preserved: iron stays on the lane it
    // entered, copper on its lane.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 10, "height": 6 }, "ticks": 200,
             "snapshots": [200],
             "entities": [
                { "type": "source", "x": 0, "y": 1, "dir": "E", "item": "iron-ore", "lane": "both", "period": 1 },
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "source", "x": 0, "y": 2, "dir": "E", "item": "copper-ore", "lane": "both", "period": 1 },
                { "type": "belt", "x": 1, "y": 2, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 2, "y": 2, "dir": "E", "tier": "fast" },
                { "type": "splitter", "x": 3, "y": 1, "dir": "E" },
                { "type": "belt", "x": 4, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 4, "y": 2, "dir": "E", "tier": "fast" } ] }"#,
    );
    for _ in 0..80 {
        w.advance();
    }
    let iron = item_index("iron-ore").unwrap();
    let copper = item_index("copper-ore").unwrap();
    let has = |w: &World, belt: usize, item: u16| -> bool {
        let (l, r) = belt_lanes(w, belt);
        l.iter().chain(r.iter()).any(|i| i.item == item)
    };
    // Output belts are entities 7 (top) and 8 (bottom).
    for belt in [7usize, 8] {
        assert!(
            has(&w, belt, iron) && has(&w, belt, copper),
            "output belt {belt} carries BOTH iron and copper, not just one type"
        );
    }
}

#[test]
fn a_splitter_spreads_one_belt_across_both_lanes_of_both_outputs() {
    // The unzip fix. ONE input belt with BOTH lanes full (iron on the left lane,
    // copper on the right) and TWO outputs must populate BOTH lanes of BOTH output
    // belts: the left-lane iron alternates across the two outputs' LEFT lanes and the
    // right-lane copper across their RIGHT lanes — with the lane preserved (iron never
    // reaches a right lane, copper never a left). It must NOT unzip (left lane to one
    // belt, right to the other, leaving two output lanes empty).
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 6, "height": 6 }, "ticks": 10, "snapshots": [10],
             "entities": [
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "splitter", "x": 2, "y": 1, "dir": "E" },
                { "type": "belt", "x": 3, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 3, "y": 2, "dir": "E", "tier": "fast" } ] }"#,
    );
    let iron = item_index("iron-ore").unwrap();
    let copper = item_index("copper-ore").unwrap();
    let mut iron_left = [false; 2]; // iron reached each output belt's left lane
    let mut copper_right = [false; 2];
    let mut crossed = false; // any item on the wrong lane?
    for _ in 0..6 {
        // Re-saturate the single input belt: left = iron, right = copper, at the edge.
        if let Machine::Belt(b) = &mut w.machines[0] {
            b.lanes[LaneSide::Left.index()] = vec![LaneItem { pos: 0, item: iron }];
            b.lanes[LaneSide::Right.index()] = vec![LaneItem {
                pos: 0,
                item: copper,
            }];
        }
        // Drain the outputs so each tick shows only that tick's placement.
        for o in [2usize, 3] {
            if let Machine::Belt(b) = &mut w.machines[o] {
                b.lanes[0].clear();
                b.lanes[1].clear();
            }
        }
        w.advance();
        for (bi, o) in [2usize, 3].into_iter().enumerate() {
            let (left, right) = belt_lanes(&w, o);
            if left.iter().any(|i| i.item == iron) {
                iron_left[bi] = true;
            }
            if right.iter().any(|i| i.item == copper) {
                copper_right[bi] = true;
            }
            if right.iter().any(|i| i.item == iron) || left.iter().any(|i| i.item == copper) {
                crossed = true;
            }
        }
    }
    assert!(
        iron_left[0] && iron_left[1],
        "left-lane iron reaches the LEFT lane of BOTH outputs (A={} B={})",
        iron_left[0],
        iron_left[1]
    );
    assert!(
        copper_right[0] && copper_right[1],
        "right-lane copper reaches the RIGHT lane of BOTH outputs (A={} B={})",
        copper_right[0],
        copper_right[1]
    );
    assert!(
        !crossed,
        "no item ever crosses lanes (iron stays left, copper stays right)"
    );
}

#[test]
fn a_lane_splitter_unzips_its_single_input_onto_the_outer_output_lanes() {
    // The lane splitter takes ONE input (the belt behind its anchor, the top cell) and
    // unzips that belt's two lanes onto the two outputs. With the input carrying iron
    // on its left lane and copper on its right, every left-lane item must land on the
    // TOP output belt's LEFT lane (its OUTER lane) and every right-lane item on the
    // BOTTOM output belt's RIGHT lane (also outer). The two INNER lanes — the top
    // belt's right lane and the bottom belt's left lane — must stay EMPTY every tick.
    // That "outer lanes only" invariant is the whole point of the unzip.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 6, "height": 6 }, "ticks": 10, "snapshots": [10],
             "entities": [
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "lane-splitter", "x": 2, "y": 1, "dir": "E" },
                { "type": "belt", "x": 3, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 3, "y": 2, "dir": "E", "tier": "fast" } ] }"#,
    );
    let iron = item_index("iron-ore").unwrap();
    let copper = item_index("copper-ore").unwrap();
    // machines: 0 = the single input belt, 1 = lane splitter, 2 = top output, 3 = bottom.
    let mut iron_top_left = false; // left-lane iron reached the top belt's outer lane
    let mut copper_bottom_right = false; // right-lane copper reached the bottom belt's outer lane
    for _ in 0..6 {
        // Re-saturate the ONE input belt: left = iron, right = copper, at the edge.
        if let Machine::Belt(b) = &mut w.machines[0] {
            b.lanes[LaneSide::Left.index()] = vec![LaneItem { pos: 0, item: iron }];
            b.lanes[LaneSide::Right.index()] = vec![LaneItem {
                pos: 0,
                item: copper,
            }];
        }
        // Drain the outputs so each tick shows only that tick's placement.
        for o in [2usize, 3] {
            if let Machine::Belt(b) = &mut w.machines[o] {
                b.lanes[0].clear();
                b.lanes[1].clear();
            }
        }
        w.advance();

        let (top_left, top_right) = belt_lanes(&w, 2);
        let (bottom_left, bottom_right) = belt_lanes(&w, 3);
        if top_left.iter().any(|i| i.item == iron) {
            iron_top_left = true;
        }
        if bottom_right.iter().any(|i| i.item == copper) {
            copper_bottom_right = true;
        }
        assert!(
            top_right.is_empty(),
            "the top belt's right (inner) lane stays empty (got {top_right:?})"
        );
        assert!(
            bottom_left.is_empty(),
            "the bottom belt's left (inner) lane stays empty (got {bottom_left:?})"
        );
        assert!(
            !top_left.iter().any(|i| i.item == copper),
            "copper (a right-lane item) never reaches the top belt"
        );
        assert!(
            !bottom_right.iter().any(|i| i.item == iron),
            "iron (a left-lane item) never reaches the bottom belt"
        );
    }
    assert!(
        iron_top_left,
        "left-lane iron is routed to the TOP output belt's outer (left) lane"
    );
    assert!(
        copper_bottom_right,
        "right-lane copper is routed to the BOTTOM output belt's outer (right) lane"
    );
}

#[test]
fn a_lane_splitter_ignores_a_belt_behind_its_second_tile() {
    // The lane splitter has only ONE input — the belt behind its anchor. A belt placed
    // behind its SECOND (bottom) tile is not an input and must be left untouched: the
    // machine never pulls from it.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 6, "height": 6 }, "ticks": 10, "snapshots": [10],
             "entities": [
                { "type": "belt", "x": 1, "y": 2, "dir": "E", "tier": "fast" },
                { "type": "lane-splitter", "x": 2, "y": 1, "dir": "E" },
                { "type": "belt", "x": 3, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 3, "y": 2, "dir": "E", "tier": "fast" } ] }"#,
    );
    let iron = item_index("iron-ore").unwrap();
    // machines: 0 = belt behind the SECOND tile (2,2) at (1,2); 1 = lane splitter.
    if let Machine::Belt(b) = &mut w.machines[0] {
        b.lanes[LaneSide::Left.index()] = vec![LaneItem { pos: 0, item: iron }];
    }
    w.advance();
    // The item is still on that belt's left lane at the edge — the machine never took it.
    let (left, _right) = belt_lanes(&w, 0);
    assert_eq!(
        left.len(),
        1,
        "the belt behind the second tile is not an input; its item is untouched"
    );
}

#[test]
fn a_splitter_routes_a_lane_item_agnostically() {
    // Item-agnostic routing: a splitter keeps ONE cursor per lane, not one per (type,
    // lane). Feeding a single lane a run of items whose TYPES alternate, the output belt
    // must still STRICTLY alternate (A, B, A, B) — an item's type has no effect on where
    // it goes. Under the old per-item-type rule the same feed grouped by type (A, A, B,
    // B), so this pins the new behavior down.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 6, "height": 6 }, "ticks": 10, "snapshots": [10],
             "entities": [
                { "type": "belt", "x": 1, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "splitter", "x": 2, "y": 1, "dir": "E" },
                { "type": "belt", "x": 3, "y": 1, "dir": "E", "tier": "fast" },
                { "type": "belt", "x": 3, "y": 2, "dir": "E", "tier": "fast" } ] }"#,
    );
    let iron = item_index("iron-ore").unwrap();
    let copper = item_index("copper-ore").unwrap();
    // Feed the LEFT lane one item per tick, alternating type; record which output belt
    // (entity 2 or 3) each fed item lands on, draining the outputs each tick.
    let feed = [iron, copper, iron, copper];
    let mut dest = Vec::new();
    for &item in &feed {
        if let Machine::Belt(b) = &mut w.machines[0] {
            b.lanes[LaneSide::Left.index()] = vec![LaneItem { pos: 0, item }];
            b.lanes[LaneSide::Right.index()].clear();
        }
        for o in [2usize, 3] {
            if let Machine::Belt(b) = &mut w.machines[o] {
                b.lanes[0].clear();
                b.lanes[1].clear();
            }
        }
        w.advance();
        for o in [2usize, 3] {
            let (left, _right) = belt_lanes(&w, o);
            if left.iter().any(|i| i.item == item) {
                dest.push(o);
            }
        }
    }
    assert_eq!(
        dest.len(),
        4,
        "each fed item lands on exactly one output belt: {dest:?}"
    );
    // Strict alternation regardless of type: consecutive items go to different belts.
    assert!(
        dest[0] != dest[1] && dest[1] != dest[2] && dest[2] != dest[3],
        "the left lane alternates its output belt every item, ignoring type: {dest:?}"
    );
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
// Furnace: the fuel gate, starved then fed ore and coal.
// ---------------------------------------------------------------------------

#[test]
fn a_starved_furnace_is_idle_then_smelts_once_fed_ore_and_coal() {
    // An iron-plate furnace (iron-ore + coal -> iron-plate, 32 ticks). Starved it
    // sits idle; fed ore but NO coal it still cannot smelt (the fuel gate); only
    // once both ore and coal are buffered does it consume a set and count down.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 8 }, "ticks": 200,
             "snapshots": [200],
             "entities": [
                { "type": "furnace", "x": 1, "y": 1, "recipe": "iron-plate" } ] }"#,
    );
    let ore = item_index("iron-ore").unwrap();
    let coal = item_index("coal").unwrap();
    // Starved: idle.
    w.advance();
    if let Machine::Furnace(f) = &w.machines[0] {
        assert_eq!(f.craft_left, 0, "no inputs -> idle");
    }
    // Feed ore but no coal: still idle — a furnace cannot smelt without fuel.
    if let Machine::Furnace(f) = &mut w.machines[0] {
        f.inputs.insert(ore, 1);
    }
    w.advance();
    if let Machine::Furnace(f) = &w.machines[0] {
        assert_eq!(
            f.craft_left, 0,
            "ore without coal -> still idle (the fuel gate)"
        );
        assert_eq!(
            f.inputs.get(&ore).copied().unwrap_or(0),
            1,
            "ore is not consumed while unfuelled"
        );
    }
    // Add coal: now it starts a smelt, consuming one ore and one coal.
    if let Machine::Furnace(f) = &mut w.machines[0] {
        f.inputs.insert(coal, 1);
    }
    w.advance();
    if let Machine::Furnace(f) = &w.machines[0] {
        assert_eq!(
            f.craft_left, 32,
            "a fuelled, fed furnace starts the CRAFT countdown"
        );
        assert_eq!(
            f.inputs.get(&ore).copied().unwrap_or(0),
            0,
            "one ore consumed at start"
        );
        assert_eq!(
            f.inputs.get(&coal).copied().unwrap_or(0),
            0,
            "one coal consumed at start"
        );
    }
    // Run the smelt out: the plate appears on the finishing tick.
    for _ in 0..32 {
        w.advance();
    }
    let plate = item_index("iron-plate").unwrap();
    if let Machine::Furnace(f) = &w.machines[0] {
        assert!(
            f.output.get(&plate).copied().unwrap_or(0) >= 1,
            "it deposited a plate"
        );
    }
}

#[test]
fn an_assembler_pauses_when_its_output_buffer_is_full() {
    // Flood the input buffer and fill the output buffer to OUTPUT_CAP: the
    // assembler must NOT start a new craft (it pauses rather than overflow), so it
    // stops consuming inputs. Uses the iron-gear recipe (iron-plate x2 -> iron-gear),
    // a non-smelting recipe, since smelting runs only on furnaces.
    let mut w = world(
        r#"{ "version": 1, "grid": { "width": 8, "height": 8 }, "ticks": 200,
             "snapshots": [200],
             "entities": [
                { "type": "assembler", "x": 1, "y": 1, "recipe": "iron-gear" } ] }"#,
    );
    let plate = item_index("iron-plate").unwrap();
    let gear = item_index("iron-gear").unwrap();
    if let Machine::Assembler(a) = &mut w.machines[0] {
        a.inputs.insert(plate, 8); // flooded inputs
        a.output.insert(gear, crate::prototypes::OUTPUT_CAP); // full output
    }
    w.advance();
    if let Machine::Assembler(a) = &w.machines[0] {
        assert_eq!(a.craft_left, 0, "a full output pauses the assembler");
        assert_eq!(
            a.inputs.get(&plate).copied().unwrap_or(0),
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
