//! The one-tick advance — the authoritative rules, in the single deterministic
//! order every faithful engine must reproduce.
//!
//! Each tick visits the machines in **scenario placement order** within each of
//! six phases, run in this exact sequence:
//!
//! 1. **Sources** emit (forced insertion onto the downstream belt's near lane,
//!    respecting compaction).
//! 2. **Inserters** advance their swing state machine (pickup → swing countdown →
//!    drop).
//! 3. **Belts** advance: compact each *run* (a chain of collinear same-direction
//!    belts) as one long lane, so a packed run moves as a rigid block and items
//!    cross tile seams by an ordinary step; then force the perpendicular
//!    curve / side-load merges across runs (near lane, curves remap equal-length).
//! 4. **Splitters** balance (round-robin pull from two inputs, round-robin push to
//!    two outputs, lanes preserved).
//! 5. **Assemblers** craft (gate check, consume one input set, count `CRAFT` down,
//!    deposit one output set).
//! 6. **Sinks** consume everything that reached them this tick.
//!
//! The ordering is the contract: it is what makes "the state after *N* ticks" a
//! single value. The reference world stores items explicitly and applies the
//! compaction clamp item-by-item; an efficient submission stores gaps and updates
//! lines in constant time, but must land on the *same* state this produces.

use crate::prototypes::{INPUT_CAP, OUTPUT_CAP, SPACING, TILE};
use crate::scenario::{Dir, Lane};
use crate::world::{LaneItem, LaneSide, Machine, World};

/// The number of distinct destinations a splitter balances across: two lanes on
/// each of its two output belts. See [`crate::world::Splitter::rr_out`].
const OUT_LANES: u8 = 4;

impl World {
    /// Advance the world by one tick, running the six phases in order.
    pub fn advance(&mut self) {
        self.advance_sources();
        self.advance_inserters();
        self.advance_belts();
        self.advance_splitters();
        self.advance_assemblers();
        self.advance_sinks();
        self.tick += 1;
    }

    // -- Phase 1: sources ---------------------------------------------------

    /// Emit from every source whose period elapses this tick, onto the downstream
    /// belt's near lane(s), respecting compaction. The emission tick convention is
    /// `t > 0 && t % period == 0` — and the tick is the one we are *advancing
    /// into*, i.e. `self.tick + 1`, so the first emit lands at `tick == period`.
    fn advance_sources(&mut self) {
        let emit_tick = self.tick + 1;
        for index in 0..self.machines.len() {
            let Machine::Source(source) = &self.machines[index] else {
                continue;
            };
            // `emit_tick` is `self.tick + 1`, always >= 1, so the `t > 0` half of
            // the `t > 0 && t % period == 0` convention is satisfied by
            // construction; only the period check remains.
            if !emit_tick.is_multiple_of(source.period as u64) {
                continue;
            }
            let (x, y, dir, item, lane) =
                (source.x, source.y, source.dir, source.item, source.lane);
            // The belt the source feeds sits one tile downstream in its facing.
            let (bx, by) = dir.step(x, y);
            let Some(belt_index) = self.machine_at(bx, by) else {
                continue;
            };
            for side in lanes_for(lane, dir, belt_index, self) {
                self.try_force_onto_belt(belt_index, side, item);
            }
        }
    }

    // -- Phase 2: inserters -------------------------------------------------

    /// Run each inserter's pickup → swing → drop state machine for one tick.
    ///
    /// - **Idle**: try to pick one item from the tile behind. On success, begin a
    ///   swing of `SWING` ticks holding the item.
    /// - **Swinging**: count the swing down. When it reaches zero, try to drop the
    ///   held item onto the tile in front; if the drop stalls (no room), keep
    ///   holding it and retry next tick.
    fn advance_inserters(&mut self) {
        for index in 0..self.machines.len() {
            let Machine::Inserter(inserter) = &self.machines[index] else {
                continue;
            };
            let (x, y, dir, swing, held, swing_left) = (
                inserter.x,
                inserter.y,
                inserter.dir,
                inserter.swing,
                inserter.held,
                inserter.swing_left,
            );

            match held {
                None => {
                    // Pickup tile is the tile *behind* the inserter (opposite its
                    // facing); the drop tile is the tile in front.
                    let (px, py) = opposite(dir).step(x, y);
                    let (dx, dy) = dir.step(x, y);
                    // Only grab when the target can take what we would carry *right
                    // now*: otherwise the arm waits empty at the pickup rather than
                    // grabbing an item and then stalling with it held over a full
                    // target. The look-ahead peeks the item without removing it and
                    // asks the target whether it would accept that item, then repeats
                    // the identical selection with `try_pickup` to actually take it.
                    //
                    // Two inserters racing one buffer both peek room and both grab in
                    // the same tick — when their swings finish, only one drop lands and
                    // the loser keeps holding (`swing_left == 1`, below). That is the
                    // one sanctioned case where an inserter hovers over its target with
                    // an item; a lone inserter never does.
                    if let Some(peeked) = self.peek_pickup(px, py, dir)
                        && self.would_accept_drop(dx, dy, dir, peeked)
                        && let Some(item) = self.try_pickup(px, py, dir)
                        && let Machine::Inserter(ins) = &mut self.machines[index]
                    {
                        ins.held = Some(item);
                        ins.swing_left = swing;
                    }
                }
                Some(item) => {
                    if swing_left > 1 {
                        if let Machine::Inserter(ins) = &mut self.machines[index] {
                            ins.swing_left -= 1;
                        }
                    } else {
                        // Swing complete: attempt the drop onto the tile in front.
                        let (dx, dy) = dir.step(x, y);
                        if self.try_drop(dx, dy, dir, item) {
                            if let Machine::Inserter(ins) = &mut self.machines[index] {
                                ins.held = None;
                                ins.swing_left = 0;
                            }
                        }
                        // else: drop stalled, keep holding with swing_left == 1
                        // so we retry next tick.
                        else if let Machine::Inserter(ins) = &mut self.machines[index] {
                            ins.swing_left = 1;
                        }
                    }
                }
            }
        }
    }

    /// Pick one item up from the tile at `(x, y)` for an inserter facing `dir`.
    /// From a belt it takes the **far lane first, then the near** (relative to the
    /// inserter); from an assembler's output buffer it takes any available output
    /// item; from a source it takes the source's item (infinite supply). Returns
    /// the picked item's index, or `None` if nothing was available.
    fn try_pickup(&mut self, x: i32, y: i32, dir: Dir) -> Option<u16> {
        let target = self.machine_at(x, y)?;
        match &mut self.machines[target] {
            Machine::Belt(belt) => {
                // Far lane first, then near, relative to the inserter's facing.
                let (near, far) = near_far_lanes(belt.dir, dir);
                for side in [far, near] {
                    let lane = &mut belt.lanes[side.index()];
                    // Take the most-downstream item (smallest pos = front of the
                    // lane) so the inserter pulls from the head of the belt.
                    if !lane.is_empty() {
                        let item = lane.remove(0).item;
                        return Some(item);
                    }
                }
                None
            }
            Machine::Assembler(assembler) => {
                // Take one of any output item present (lowest item index for
                // determinism).
                let mut keys: Vec<u16> = assembler
                    .output
                    .iter()
                    .filter(|&(_, &c)| c > 0)
                    .map(|(&k, _)| k)
                    .collect();
                keys.sort_unstable();
                let item = *keys.first()?;
                if let Some(count) = assembler.output.get_mut(&item) {
                    *count -= 1;
                    return Some(item);
                }
                None
            }
            Machine::Source(source) => Some(source.item),
            _ => None,
        }
    }

    /// Peek the item an inserter facing `dir` **would** pick up from the tile at
    /// `(x, y)`, without removing it. Mirrors [`World::try_pickup`]'s selection
    /// exactly — the far lane before the near for a belt, the lowest output item
    /// index for an assembler, the source's item for a source — so the peeked item
    /// is the one an immediately-following `try_pickup` takes. Used by the inserter's
    /// look-ahead so it grabs only when the target can accept what it would carry.
    fn peek_pickup(&self, x: i32, y: i32, dir: Dir) -> Option<u16> {
        let target = self.machine_at(x, y)?;
        match &self.machines[target] {
            Machine::Belt(belt) => {
                let (near, far) = near_far_lanes(belt.dir, dir);
                for side in [far, near] {
                    if let Some(front) = belt.lanes[side.index()].first() {
                        return Some(front.item);
                    }
                }
                None
            }
            Machine::Assembler(assembler) => assembler
                .output
                .iter()
                .filter(|&(_, &c)| c > 0)
                .map(|(&k, _)| k)
                .min(),
            Machine::Source(source) => Some(source.item),
            _ => None,
        }
    }

    /// Drop `item` onto the tile at `(x, y)` for an inserter facing `dir`. Onto a
    /// belt it **forces** the item onto the near lane (relative to the inserter)
    /// under the compaction rule, stalling if no gap is large enough; into an
    /// assembler's input buffer it adds one if there is room; into a sink it is
    /// consumed. Returns `true` if the drop landed.
    fn try_drop(&mut self, x: i32, y: i32, dir: Dir, item: u16) -> bool {
        let Some(target) = self.machine_at(x, y) else {
            return false;
        };
        match &self.machines[target] {
            Machine::Belt(belt) => {
                let (near, _) = near_far_lanes(belt.dir, dir);
                self.try_force_onto_belt(target, near, item)
            }
            Machine::Assembler(_) => self.try_assembler_input(target, item),
            Machine::Sink(_) => {
                self.consume_into_sink(target, item);
                true
            }
            _ => false,
        }
    }

    /// Whether an inserter facing `dir` could drop `item` onto the tile at `(x, y)`
    /// **right now**, without performing the drop. Mirrors [`World::try_drop`]'s
    /// acceptance test — the belt forcing-gap rule at the input slot, the assembler
    /// input-and-capacity rule, a sink always — so the inserter's look-ahead only
    /// commits to a pickup when the target can currently take the peeked item.
    fn would_accept_drop(&self, x: i32, y: i32, dir: Dir, item: u16) -> bool {
        let Some(target) = self.machine_at(x, y) else {
            return false;
        };
        match &self.machines[target] {
            Machine::Belt(belt) => {
                let (near, _) = near_far_lanes(belt.dir, dir);
                lane_accepts(&belt.lanes[near.index()], TILE - SPACING)
            }
            Machine::Assembler(assembler) => {
                let is_input = assembler
                    .recipe
                    .inputs
                    .iter()
                    .any(|t| crate::prototypes::item_index(t.item) == Some(item));
                is_input && assembler.inputs.get(&item).copied().unwrap_or(0) < INPUT_CAP
            }
            Machine::Sink(_) => true,
            _ => false,
        }
    }

    /// Add one `item` to an assembler's input buffer if it is a recipe input and
    /// there is room (`< INPUT_CAP` of it). Returns whether it landed.
    fn try_assembler_input(&mut self, index: usize, item: u16) -> bool {
        let Machine::Assembler(assembler) = &mut self.machines[index] else {
            return false;
        };
        // Only accept items the recipe actually consumes.
        let is_input = assembler
            .recipe
            .inputs
            .iter()
            .any(|t| crate::prototypes::item_index(t.item) == Some(item));
        if !is_input {
            return false;
        }
        let count = assembler.inputs.entry(item).or_insert(0);
        if *count >= INPUT_CAP {
            return false;
        }
        *count += 1;
        true
    }

    /// Consume one `item` into a sink, incrementing its per-item count.
    fn consume_into_sink(&mut self, index: usize, item: u16) {
        if let Machine::Sink(sink) = &mut self.machines[index] {
            *sink.consumed.entry(item).or_insert(0) += 1;
        }
    }

    // -- Phase 3: belts -----------------------------------------------------

    /// Advance every belt: compact each **run** as one long lane, then merge the
    /// perpendicular (curve / side-load) hand-offs.
    ///
    /// A run is a chain of collinear same-direction belts ([`World::runs`]). Moving
    /// it as one lane — rather than compacting each tile and passing one lead item
    /// per tile per tick — is what makes a saturated line behave the way the spec
    /// requires: a packed run advances as a single **rigid block**, so it reads as
    /// frozen, and when its front item is consumed the whole run shifts one step in
    /// the *same* tick (the freed slot appears only at the very back) instead of a
    /// hole crawling backward one tile per tick. It also removes the tile seam as a
    /// special case, so an item crosses between tiles by an ordinary `speed`-step
    /// with no jump.
    fn advance_belts(&mut self) {
        // `runs` is derived once from the static layout and never mutated here;
        // take it out so the compaction pass can borrow `self.machines` mutably.
        let runs = std::mem::take(&mut self.runs);
        for run in &runs {
            self.compact_run_lane(run, LaneSide::Left);
            self.compact_run_lane(run, LaneSide::Right);
        }
        self.runs = runs;

        // Perpendicular hand-offs (curves and side-loads) are cross-run merges, not
        // rigid-block flow, so they force one lead item across per tick — after the
        // runs have compacted, exactly as a source or inserter forces onto a belt.
        self.merge_perpendicular();
    }

    /// Compact one lane of a whole run as a single long lane.
    ///
    /// An item on run tile `i` (0 = the most-downstream tile) at position `p` sits
    /// at the run-global coordinate `g = i * TILE + p`. Because each belt's lane is
    /// ascending by `pos` and the run is ordered downstream-first, concatenating
    /// the tiles' lanes is already ascending by `g`. The standard movement clamp
    /// then runs once over the whole sequence — each item moving forward by the
    /// SPEED of the tile it currently sits on, never past the run's output edge
    /// (`g == 0`) and never within `SPACING` of the item ahead — and the results
    /// are written back to the per-tile lanes.
    fn compact_run_lane(&mut self, run: &[usize], side: LaneSide) {
        let s = side.index();
        let last = run.len() - 1;

        // Gather (global position, item), already ascending.
        let mut items: Vec<(u32, u16)> = Vec::new();
        for (i, &bi) in run.iter().enumerate() {
            if let Machine::Belt(b) = &self.machines[bi] {
                for it in &b.lanes[s] {
                    items.push((i as u32 * TILE + it.pos, it.item));
                }
            }
        }
        if items.is_empty() {
            return;
        }

        // One backward pass with the movement clamp over the concatenated lane.
        let mut ahead: Option<u32> = None;
        for slot in &mut items {
            let g = slot.0;
            // The tile the item currently sits on sets its speed (min-clamped so a
            // relaxed-back item momentarily at the input edge stays in bounds).
            let tile = (g / TILE).min(last as u32) as usize;
            let speed = match &self.machines[run[tile]] {
                Machine::Belt(b) => b.speed,
                _ => 0,
            };
            let floor = match ahead {
                None => 0,
                Some(a) => a + SPACING,
            };
            let new_g = g.saturating_sub(speed).max(floor);
            slot.0 = new_g;
            ahead = Some(new_g);
        }

        // Redistribute to per-tile lanes.
        for &bi in run {
            if let Machine::Belt(b) = &mut self.machines[bi] {
                b.lanes[s].clear();
            }
        }
        for (g, item) in items {
            let tile = (g / TILE).min(last as u32) as usize;
            let pos = g - tile as u32 * TILE;
            if let Machine::Belt(b) = &mut self.machines[run[tile]] {
                b.lanes[s].push(LaneItem { pos, item });
            }
        }
    }

    /// Merge each belt whose downstream tile holds a **perpendicular** belt: a
    /// curve or a side-load. Its lead item (at the output edge) is forced onto the
    /// mapped lane of the target belt at the standard entry coordinate, under the
    /// forcing rule — the same one-item-per-tick merge a source or inserter makes.
    /// Collinear neighbours are never seen here; they are part of the same run and
    /// were advanced together by [`World::compact_run_lane`].
    fn merge_perpendicular(&mut self) {
        for index in 0..self.machines.len() {
            let Machine::Belt(belt) = &self.machines[index] else {
                continue;
            };
            let (x, y, dir) = (belt.x, belt.y, belt.dir);
            let (nx, ny) = dir.step(x, y);
            let Some(down_index) = self.machine_at(nx, ny) else {
                continue;
            };
            let Machine::Belt(down) = &self.machines[down_index] else {
                continue;
            };
            let down_dir = down.dir;
            if down_dir == dir {
                continue; // collinear — same run, already advanced
            }

            for src_side in [LaneSide::Left, LaneSide::Right] {
                let lead = match &self.machines[index] {
                    Machine::Belt(b) => b.lanes[src_side.index()].first().copied(),
                    _ => None,
                };
                let Some(lead) = lead else { continue };
                if lead.pos != 0 {
                    continue; // only an item that has reached the output edge crosses
                }
                let dest_side = map_lane(dir, down_dir, src_side);
                if self.try_force_onto_belt(down_index, dest_side, lead.item)
                    && let Machine::Belt(b) = &mut self.machines[index]
                {
                    b.lanes[src_side.index()].remove(0);
                }
            }
        }
    }

    // -- Phase 4: splitters -------------------------------------------------

    /// Balance every splitter: round-robin pull one item from its two input belts,
    /// round-robin push across the four output lanes (both lanes of both output
    /// belts). A base splitter retains no items between ticks, so each pulled item
    /// is pushed in the same tick (or, if the chosen output stalls, returned to
    /// its input).
    fn advance_splitters(&mut self) {
        for index in 0..self.machines.len() {
            let Machine::Splitter(splitter) = &self.machines[index] else {
                continue;
            };
            let (x, y, dir, mut rr_in, mut rr_out) = (
                splitter.x,
                splitter.y,
                splitter.dir,
                splitter.rr_in,
                splitter.rr_out,
            );
            let inputs = splitter_input_belts(self, x, y, dir);
            let outputs = splitter_output_belts(self, x, y, dir);

            // Try to move up to two items this tick (one per input belt), so a
            // saturated pair of inputs both make progress.
            for _ in 0..2 {
                let in_belt = inputs[rr_in as usize];
                let Some(in_belt) = in_belt else {
                    rr_in ^= 1;
                    continue;
                };
                // Pull the lead item of either lane (left first) of the input belt.
                let pulled = pull_lead(self, in_belt);
                let Some((side, item)) = pulled else {
                    rr_in ^= 1;
                    continue;
                };
                // Push to the next output *lane*. The item's input lane is not
                // preserved: the splitter balances across all four output lanes
                // (both lanes of both belts), so a saturated splitter fills each
                // of them equally — 20 items in becomes 10 per belt, 5 per lane.
                //
                // The cursor walks the four lanes GROUPED BY BELT — belt0-left,
                // belt0-right, belt1-left, belt1-right (`belt = rr_out >> 1`,
                // `lane = rr_out & 1`) — NOT interleaved by belt. This is what keeps
                // a same-tick pair aligned: the two items moved this tick land on the
                // *same* output belt's two lanes at the same entry position, so they
                // travel out side by side, instead of the old interleaved order
                // (belt0-left then belt1-left) that filled each belt's two lanes on
                // alternating ticks and made the output visibly zipper/stagger. The
                // balance is unchanged (still 10 per belt, 5 per lane over 20).
                //
                // An output tile with NO BELT AT ALL can never accept anything, so
                // step past it rather than treating it as back pressure: a splitter
                // with one output belt sends everything to that belt (alternating
                // its two lanes). Treating an absent output as a stall deadlocked
                // the splitter permanently — the cursor parked on the empty side,
                // and since a stall does not advance it, every later tick chose the
                // same empty side and pushed the item back.
                //
                // A belt that EXISTS but is full is different: that is real back
                // pressure and still stalls, which is what makes a saturated line
                // back up rather than silently drop throughput.
                for _ in 0..OUT_LANES {
                    if outputs[(rr_out >> 1) as usize].is_some() {
                        break;
                    }
                    rr_out = (rr_out + 1) % OUT_LANES;
                }
                let out_belt = outputs[(rr_out >> 1) as usize];
                let out_side = if rr_out & 1 == 0 {
                    LaneSide::Left
                } else {
                    LaneSide::Right
                };
                let pushed = match out_belt {
                    Some(out_belt) => self.try_force_onto_belt(out_belt, out_side, item),
                    // Neither side has a belt — there is nowhere for this to go.
                    None => false,
                };
                if pushed {
                    rr_out = (rr_out + 1) % OUT_LANES;
                } else {
                    // Output stalled — put the item back where it came from and
                    // stop advancing this splitter this tick.
                    push_back(self, in_belt, side, item);
                    break;
                }
                rr_in ^= 1;
            }

            if let Machine::Splitter(s) = &mut self.machines[index] {
                s.rr_in = rr_in;
                s.rr_out = rr_out;
            }
        }
    }

    // -- Phase 5: assemblers ------------------------------------------------

    /// Advance every assembler's craft. If it is mid-craft, count down and deposit
    /// the output set on completion. If it is idle and the input buffer holds a
    /// full recipe set **and** the output buffer has room for the recipe's output
    /// set, consume one input set and start the `CRAFT` countdown.
    fn advance_assemblers(&mut self) {
        for index in 0..self.machines.len() {
            let Machine::Assembler(assembler) = &mut self.machines[index] else {
                continue;
            };
            if assembler.craft_left > 1 {
                assembler.craft_left -= 1;
                continue;
            }
            if assembler.craft_left == 1 {
                // Finishing tick: deposit one output set. The room check was done
                // at craft start, so it always fits.
                for term in assembler.recipe.outputs {
                    let idx = crate::prototypes::item_index(term.item).expect("recipe item");
                    *assembler.output.entry(idx).or_insert(0) += term.count;
                }
                assembler.craft_left = 0;
            }
            // Idle (craft_left == 0): try to start a new craft.
            if can_start_craft(assembler) {
                consume_input_set(assembler);
                assembler.craft_left = assembler.recipe.craft;
            }
        }
    }

    // -- Phase 6: sinks -----------------------------------------------------

    /// Consume every item that has flowed onto a belt feeding a sink. An inbound
    /// belt facing into the sink hands its edge items to the sink; the sink also
    /// directly absorbs anything dropped onto it (handled in [`try_drop`]).
    fn advance_sinks(&mut self) {
        for index in 0..self.machines.len() {
            let Machine::Sink(sink) = &self.machines[index] else {
                continue;
            };
            let (sx, sy) = (sink.x, sink.y);
            // Drain every belt that feeds directly into the sink (a belt one tile
            // away whose facing points at the sink tile).
            for dir in [Dir::N, Dir::S, Dir::E, Dir::W] {
                // The neighbour tile in each direction from the sink.
                let (bx, by) = dir.step(sx, sy);
                let Some(belt_index) = self.machine_at(bx, by) else {
                    continue;
                };
                let feeds = match &self.machines[belt_index] {
                    Machine::Belt(b) => b.dir.step(bx, by) == (sx, sy),
                    _ => false,
                };
                if !feeds {
                    continue;
                }
                // Pull every item that has reached the feeding belt's output edge.
                loop {
                    let mut drained = false;
                    for side in [LaneSide::Left, LaneSide::Right] {
                        let lead = match &self.machines[belt_index] {
                            Machine::Belt(b) => b.lanes[side.index()].first().copied(),
                            _ => None,
                        };
                        if let Some(lead) = lead
                            && lead.pos == 0
                        {
                            if let Machine::Belt(b) = &mut self.machines[belt_index] {
                                b.lanes[side.index()].remove(0);
                            }
                            self.consume_into_sink(index, lead.item);
                            drained = true;
                        }
                    }
                    if !drained {
                        break;
                    }
                }
            }
        }
    }

    // -- forcing helpers ----------------------------------------------------

    /// Force `item` onto a belt's lane at its **input end** (`pos == TILE -
    /// SPACING` … the standard entry coordinate one standard spacing inside the
    /// input edge) under the compaction rule: it lands only if the gap to the
    /// nearest item there is strictly larger than `SPACING`. Returns whether it
    /// landed.
    fn try_force_onto_belt(&mut self, index: usize, side: LaneSide, item: u16) -> bool {
        // A forced item enters at the input end of the belt. We place it at the
        // furthest-back standard slot (TILE - SPACING) so it joins the tail of the
        // lane; the forcing rule checks the gap to the item already there.
        self.try_force_onto_belt_at(index, side, item, TILE - SPACING)
    }

    /// Force `item` onto a belt's lane at position `pos`, honouring the forcing
    /// rule. The item lands iff the gap to the nearest existing item (ahead or
    /// behind on the lane) is **at least `SPACING`**; it may sit momentarily
    /// closer than `SPACING` (squashed) and the next belt move relaxes it back.
    /// Returns whether it landed.
    ///
    /// The bound is `>= SPACING`, not `> SPACING`. A strict bound makes the
    /// standard entry coordinate (`TILE - SPACING`) unreachable on a compacted
    /// lane: the item ahead sits at `TILE - 2 * SPACING`, so the gap is *exactly*
    /// `SPACING` and every force is refused. That capped a saturated lane at
    /// three items per tile with the last slot permanently empty, and a "full"
    /// belt visibly ran with a gap in every tile.
    fn try_force_onto_belt_at(
        &mut self,
        index: usize,
        side: LaneSide,
        item: u16,
        pos: u32,
    ) -> bool {
        let Machine::Belt(belt) = &mut self.machines[index] else {
            return false;
        };
        let lane = &mut belt.lanes[side.index()];
        if !lane_accepts(lane, pos) {
            return false;
        }
        let insert_at = lane.partition_point(|i| i.pos < pos);
        lane.insert(insert_at, LaneItem { pos, item });
        true
    }
}

/// Whether an item may be forced into `lane` at `pos`: the exact slot is free and
/// the gap to the neighbour on each side is **at least `SPACING`**. This is the
/// read-only core of the forcing rule (see `try_force_onto_belt_at` for why the
/// bound is `>= SPACING`, not `>`), shared by the mutating force and by the
/// inserter's look-ahead so the two agree on what a belt will accept.
fn lane_accepts(lane: &[LaneItem], pos: u32) -> bool {
    let insert_at = lane.partition_point(|i| i.pos < pos);
    if let Some(after) = lane.get(insert_at) {
        // `after` is the first item with pos >= ours: an exact hit is occupied, and
        // a gap under standard spacing to the item behind leaves no room.
        if after.pos == pos || after.pos.saturating_sub(pos) < SPACING {
            return false;
        }
    }
    if insert_at > 0 && pos.saturating_sub(lane[insert_at - 1].pos) < SPACING {
        return false;
    }
    true
}

/// The direction opposite `dir`.
fn opposite(dir: Dir) -> Dir {
    match dir {
        Dir::N => Dir::S,
        Dir::S => Dir::N,
        Dir::E => Dir::W,
        Dir::W => Dir::E,
    }
}

/// The physical world offset of a belt's left lane centre, relative to the tile
/// centre, for a belt facing `dir`. The left lane is 90° counter-clockwise of
/// travel: E→north(-y), N→west(-x), W→south(+y), S→east(+x).
fn left_offset(dir: Dir) -> (i32, i32) {
    match dir {
        Dir::E => (0, -1),
        Dir::N => (-1, 0),
        Dir::W => (0, 1),
        Dir::S => (1, 0),
    }
}

/// Which lane side of a belt facing `belt_dir` sits on each physical side,
/// expressed as the (near, far) pair relative to an inserter/source facing
/// `actor_dir`. "Near" is the lane on the same physical side as the actor's
/// approach; "far" is the other. This implements the documented pickup/drop lane
/// order (far lane first for pickup; near lane for drop).
fn near_far_lanes(belt_dir: Dir, actor_dir: Dir) -> (LaneSide, LaneSide) {
    // The actor approaches along `actor_dir`; the side of the belt nearest the
    // actor is the one whose physical offset points back toward the actor (i.e.
    // opposite the actor's travel). Compare the belt's left-lane offset to that.
    let (ax, ay) = opposite(actor_dir).delta();
    let (lx, ly) = left_offset(belt_dir);
    if (lx, ly) == (ax, ay) {
        (LaneSide::Left, LaneSide::Right)
    } else {
        (LaneSide::Right, LaneSide::Left)
    }
}

/// Map a source's `lane` selector onto concrete lane sides of the downstream
/// belt. `left`/`right` name the belt's own lanes (relative to its travel
/// direction); `both` targets both, left then right.
fn lanes_for(lane: Lane, _source_dir: Dir, belt_index: usize, world: &World) -> Vec<LaneSide> {
    if !matches!(&world.machines[belt_index], Machine::Belt(_)) {
        return Vec::new();
    }
    match lane {
        Lane::Left => vec![LaneSide::Left],
        Lane::Right => vec![LaneSide::Right],
        Lane::Both => vec![LaneSide::Left, LaneSide::Right],
    }
}

/// Map a lane side from an upstream belt facing `from` onto the downstream belt
/// facing `to`. When the two belts are collinear (`from == to`, end-feeding) the
/// lane is preserved by physical side. When they are perpendicular (a curve), the
/// lanes remap equal-length: the physical side is carried across the turn so the
/// outer lane stays outer.
fn map_lane(from: Dir, to: Dir, side: LaneSide) -> LaneSide {
    if from == to {
        return side;
    }
    // Carry the physical side across the turn: find the physical offset of this
    // lane on the source belt, then find which lane of the destination belt sits
    // on that same physical side.
    let src_left = left_offset(from);
    let phys = if side == LaneSide::Left {
        src_left
    } else {
        (-src_left.0, -src_left.1)
    };
    let dst_left = left_offset(to);
    if phys == dst_left {
        LaneSide::Left
    } else {
        LaneSide::Right
    }
}

// ---------------------------------------------------------------------------
// Splitter helpers — resolve the two input and two output belts of a splitter,
// pull the lead item of a belt, and push one back on a stall.
// ---------------------------------------------------------------------------

/// The two tiles directly upstream of a splitter's two-tile footprint (the tiles
/// behind each half), resolved to belt machine indices if present.
fn splitter_input_belts(world: &World, x: i32, y: i32, dir: Dir) -> [Option<usize>; 2] {
    let (sx, sy) = crate::world::splitter_second_tile(x, y, dir);
    let back = opposite(dir);
    let (ax, ay) = back.step(x, y);
    let (bx, by) = back.step(sx, sy);
    [
        belt_index_at(world, ax, ay, dir),
        belt_index_at(world, bx, by, dir),
    ]
}

/// The two tiles directly downstream of a splitter's footprint, resolved to belt
/// indices if present.
fn splitter_output_belts(world: &World, x: i32, y: i32, dir: Dir) -> [Option<usize>; 2] {
    let (sx, sy) = crate::world::splitter_second_tile(x, y, dir);
    let (ax, ay) = dir.step(x, y);
    let (bx, by) = dir.step(sx, sy);
    [
        belt_index_at(world, ax, ay, dir),
        belt_index_at(world, bx, by, dir),
    ]
}

/// The belt at `(x, y)`, but only if it shares the splitter's flow direction (so
/// a stray perpendicular belt is not mistaken for an input/output).
fn belt_index_at(world: &World, x: i32, y: i32, dir: Dir) -> Option<usize> {
    let index = world.machine_at(x, y)?;
    match &world.machines[index] {
        Machine::Belt(b) if b.dir == dir => Some(index),
        _ => None,
    }
}

/// Pull the lead item (smallest pos) of a belt, left lane first then right.
/// Returns the lane it came from and the item.
fn pull_lead(world: &mut World, belt_index: usize) -> Option<(LaneSide, u16)> {
    let Machine::Belt(belt) = &mut world.machines[belt_index] else {
        return None;
    };
    for side in [LaneSide::Left, LaneSide::Right] {
        let lane = &mut belt.lanes[side.index()];
        if let Some(lead) = lane.first().copied() {
            // Only pull items that have reached the output edge of the belt.
            if lead.pos == 0 {
                lane.remove(0);
                return Some((side, lead.item));
            }
        }
    }
    None
}

/// Put an item back at the output edge of a belt's lane (used when a splitter's
/// chosen output stalled). It returns to `pos == 0`, where it was pulled from.
fn push_back(world: &mut World, belt_index: usize, side: LaneSide, item: u16) {
    if let Machine::Belt(belt) = &mut world.machines[belt_index] {
        belt.lanes[side.index()].insert(0, LaneItem { pos: 0, item });
    }
}

// ---------------------------------------------------------------------------
// Assembler helpers.
// ---------------------------------------------------------------------------

/// Whether an idle assembler may start a craft: the input buffer holds a full
/// recipe input set AND the output buffer has room for the recipe's output set.
fn can_start_craft(assembler: &crate::world::Assembler) -> bool {
    for term in assembler.recipe.inputs {
        let idx = crate::prototypes::item_index(term.item).expect("recipe item");
        if assembler.inputs.get(&idx).copied().unwrap_or(0) < term.count {
            return false;
        }
    }
    for term in assembler.recipe.outputs {
        let idx = crate::prototypes::item_index(term.item).expect("recipe item");
        let have = assembler.output.get(&idx).copied().unwrap_or(0);
        if have + term.count > OUTPUT_CAP {
            return false;
        }
    }
    true
}

/// Consume one input set from an idle assembler's input buffer (called only when
/// [`can_start_craft`] is true).
fn consume_input_set(assembler: &mut crate::world::Assembler) {
    for term in assembler.recipe.inputs {
        let idx = crate::prototypes::item_index(term.item).expect("recipe item");
        if let Some(count) = assembler.inputs.get_mut(&idx) {
            *count -= term.count;
        }
    }
}

#[cfg(test)]
#[path = "tick.test.rs"]
mod tests;
