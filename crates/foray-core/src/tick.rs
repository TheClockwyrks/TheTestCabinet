//! The tick advance: one fixed timestep of the game, in the exact order the
//! rules require.
//!
//! Per tick, [`advance`] applies five phases in this order — and the order is
//! load-bearing, so it is spelled out here and mirrored by the tests:
//!
//! 1. **Movement.** Each agent's submitted direction is resolved under the
//!    [carry-weight speed model](crate::config::Rules): a light raider moves every
//!    tick (faster than a soldier), a soldier moves just under one tile/tick, and
//!    a laden raider stalls between steps as its [`move_speed`](crate::state::Agent::move_speed)
//!    drops with load. A move into a wall or off the board (or any move for an
//!    agent that has not banked a full step) clamps to `Stop` — never a forfeit.
//!    The only tile-*swap* forbidden is the tag-dodging one — a soldier and an
//!    enemy raider trading places in one tick, which would let the raider pass
//!    *through* the defender untagged. That swap is cancelled **and settled in the
//!    tagging phase**, as though the two had met: the defender catches the raider as
//!    it tries to slip past. Cancelling alone was a deadlock — see the note below.
//!    Any other head-on swap (two soldiers crossing the seam, two raiders passing as
//!    each heads home) resolves, since no tag is at stake.
//! 2. **Eating.** A raider that ends the tick on an enemy seed cache consumes it
//!    into its carried load.
//! 3. **Banking.** A raider that crossed back onto its own half this tick adds
//!    its entire load to the team score and resets the load to zero.
//! 4. **Tagging.** Two *engaged* enemies settle it — engaged meaning they share a
//!    tile, **or** they just tried to trade tiles and movement cancelled the swap.
//!    Either way the pair is always one soldier (on the half the encounter happens
//!    on) against one enemy raider, because a role is decided purely by which half a
//!    tile is on; there is no other pairing. The outcome turns only on royal jelly:
//!    - **both immune** — nothing happens;
//!    - **exactly one immune** — the immune one tags the other;
//!    - **neither immune** — the soldier tags the raider.
//!
//!    So an immune ant cannot be killed, and kills any non-immune enemy it meets.
//!    A tagged ant respawns at its nest; a tagged *raider* also scatters its carried
//!    load onto the maze at the tag tile as recoverable caches.
//! 5. **Jelly.** A raider that ends the tick on an active royal-jelly node consumes
//!    it and gains `J` ticks of immunity. The node then **regrows at the same tile**
//!    after `jelly_respawn_ticks`, so the counter to a parked defender is renewable.
//!
//! Then immunity decrements and win conditions are checked.
//!
//! Settling the cancelled swap in the tagging phase is not a flourish — it is what
//! keeps the board alive. A cancelled pair never shares a tile, so tagging would
//! never see the encounter; two controllers that each keep issuing the same swap
//! would then hold *forever*, neither able to move. That is not hypothetical: it
//! froze real baseline matches solid for 37,000 ticks, score stuck, running out the
//! clock. It is the identical trap that was already found and fixed for the
//! soldier/soldier swap (see [`movement`]) — this is the other half of it.
//!
//! Two orderings are load-bearing. **Eating precedes tagging**, so a raider can be
//! tagged on the very tile it just ate — intentional. **Banking precedes tagging**,
//! so an ant that reaches home banks before it can be killed there. That ordering is
//! inert under the v1 rules (only raiders were taggable, and a raider is by
//! definition *not* on its own half, so the two phases could never touch the same
//! agent) but it is essential now that soldiers are killable: a raider crossing home
//! is a soldier the instant it lands, and it still holds its load until banking. Tag
//! it first and an immune enemy could kill a returning carrier whose load came from
//! the *other* half — which would scatter those seeds onto the wrong side, quietly
//! breaking seed conservation and with it the sweep condition.

use crate::board::{Board, Pos, Team};
use crate::config::{Rules, Simulation};
use crate::contract::Action;
use crate::state::{Ended, MatchResult, MatchState, Role};

/// Advance `state` by one tick, applying `red`'s and `blue`'s actions. The actions
/// are assumed already contract-valid (the host validates before calling this, and
/// never advances the tick a controller forfeited on); this function only ever
/// *clamps* blocked moves, it never rejects.
///
/// Returns the [`MatchResult`] if this tick ended the match, else `None`. Calling
/// `advance` on an already-decided match is a no-op returning the stored result.
pub fn advance(
    board: &Board,
    state: &mut MatchState,
    red: &Action,
    blue: &Action,
    rules: &Rules,
    sim: &Simulation,
) -> Option<MatchResult> {
    if let Some(result) = state.result {
        return Some(result);
    }

    state.tick += 1;

    // Snapshot each agent's half *before* movement so banking can detect a
    // border crossing back home. Indexed by the agent's slot in `state.agents`.
    let was_on_own_half: Vec<bool> = state
        .agents
        .iter()
        .map(|a| board.team_of_column(a.pos.x) == a.team)
        .collect();

    let cancelled_swaps = movement(board, state, red, blue, rules);
    eating(board, state);
    banking(board, state, rules, &was_on_own_half);
    tagging(board, state, &cancelled_swaps);
    jelly(board, state, rules);
    regrow_jelly(state);
    large_seeds(board, state, rules);

    // Immunity ticks down once per tick, after all phases that read it.
    for agent in &mut state.agents {
        agent.immune_ticks = agent.immune_ticks.saturating_sub(1);
    }

    let result = decide(state, sim);
    state.result = result;
    result
}

/// Phase 1 — movement under the carry-weight speed model. Returns the soldier/raider
/// swaps it cancelled, as `(index, index)` pairs, so [`tagging`] can settle them: the
/// two never share a tile, so tagging would otherwise never see the encounter at all.
fn movement(
    board: &Board,
    state: &mut MatchState,
    red: &Action,
    blue: &Action,
    rules: &Rules,
) -> Vec<(usize, usize)> {
    // Resolve every agent's intended target first (reads only pre-move state),
    // then apply — so one agent's move never changes another's eligibility within
    // the same tick. Two agents may share a tile, so there is no collision step;
    // the one thing we forbid is a *swap* (handled below).
    let n = state.agents.len();
    let from: Vec<Pos> = state.agents.iter().map(|a| a.pos).collect();
    // The charge each agent will have banked this tick (current + this tick's
    // earnings). Carried into the apply pass so speed is computed once.
    let mut charge: Vec<u32> = Vec::with_capacity(n);
    let mut targets: Vec<Pos> = Vec::with_capacity(n);
    let mut moved: Vec<bool> = Vec::with_capacity(n);

    for agent in &state.agents {
        let action = match agent.team {
            Team::Red => red,
            Team::Blue => blue,
        };
        let dir = action.dir_for(agent.id);

        // Earn this tick's charge; the agent may step only once it reaches the
        // resolution. A raider mid-stall under carry weight is not yet eligible,
        // and any move submitted for it is a no-op (clamped to Stop).
        let banked = agent.move_accum + agent.move_speed(board, rules);
        let eligible = banked >= rules.move_resolution;
        let target = if eligible {
            dir.apply(agent.pos)
        } else {
            agent.pos
        };

        // A move into a wall or off the board clamps to Stop (stay put).
        let (final_pos, did_move) = if target != agent.pos && board.is_passable(target) {
            (target, true)
        } else {
            (agent.pos, false)
        };
        charge.push(banked);
        targets.push(final_pos);
        moved.push(did_move);
    }

    // Forbid only the *tag-evading* position swap. Two agents may share a tile, so
    // moving onto another agent is fine; the danger a swap poses is exactly one: a
    // soldier and an *enemy raider* trading places never share a tile, so the
    // raider would slip past untagged. That — opposite teams, one soldier and one
    // raider — is the only swap we cancel.
    //
    // Two agents of the *same* role crossing in opposite directions (most commonly
    // two soldiers meeting head-on at the central seam, or two laden raiders
    // passing as each heads home) put no tag at stake, so they pass through each
    // other. Cancelling those was a deadlock trap: on the mirrored board, two
    // controllers that both beeline for the nearest crossing would freeze face-to-
    // face at the seam forever and neither could ever raid — every competent pair
    // drew 0–0. Letting harmless swaps resolve keeps the anti-evasion guarantee
    // while removing the standoff.
    //
    // The soldier/raider swap keeps its cancellation — but cancelling *alone* is the
    // very same deadlock trap, one half of which was already found and fixed above.
    // Two controllers that each keep issuing the swap simply hold, forever: the pair
    // never shares a tile, so tagging never sees them, and neither ever moves again.
    // That is not hypothetical — it froze real baseline matches solid for 37,000
    // ticks. So the cancelled pair is *reported out* and settled by [`tagging`]: the
    // defender catches the raider as it tries to slip past. The anti-evasion promise
    // gets stronger, not weaker, and the standoff cannot form.
    let role_at = |team: Team, pos: Pos| -> Role {
        if board.team_of_column(pos.x) == team {
            Role::Soldier
        } else {
            Role::Raider
        }
    };
    let mut cancelled_swaps: Vec<(usize, usize)> = Vec::new();
    for i in 0..n {
        if !moved[i] {
            continue;
        }
        for j in (i + 1)..n {
            if moved[j] && targets[i] == from[j] && targets[j] == from[i] {
                // A tag is at stake only across teams with mismatched roles (one
                // soldier, one raider); that is the lone swap that lets a raider
                // evade a tag, so only it is cancelled. Roles are read from the
                // pre-move tiles, the positions the swap is between.
                let opposing = state.agents[i].team != state.agents[j].team;
                let tag_at_stake = opposing
                    && role_at(state.agents[i].team, from[i])
                        != role_at(state.agents[j].team, from[j]);
                if tag_at_stake {
                    targets[i] = from[i];
                    moved[i] = false;
                    targets[j] = from[j];
                    moved[j] = false;
                    cancelled_swaps.push((i, j));
                }
                break; // agent i has only one target, so only one possible swap
            }
        }
    }

    for (i, agent) in state.agents.iter_mut().enumerate() {
        agent.pos = targets[i];
        agent.move_accum = if moved[i] {
            // Spent one tile's worth of charge; the remainder carries to next tick.
            charge[i] - rules.move_resolution
        } else {
            // Held this tick (stalled, blocked, or a cancelled swap): keep the
            // charge so the agent steps as soon as it can, capped at one step so a
            // long hold cannot bank multiple moves.
            charge[i].min(rules.move_resolution)
        };
    }

    cancelled_swaps
}

/// Phase 2 — eating. A raider on an enemy cache consumes it into its load; a raider
/// on an enemy *large* seed picks that up instead, whole.
fn eating(board: &Board, state: &mut MatchState) {
    for i in 0..state.agents.len() {
        let agent = &state.agents[i];
        if agent.role(board) != Role::Raider {
            continue;
        }
        // The raider stands on the enemy half; the caches it can eat are that
        // half's caches (the opponent's home caches).
        let enemy_half = agent.team.opponent();
        let pos = agent.pos;
        if state.caches(enemy_half).contains(&pos) {
            state.caches_mut(enemy_half).remove(&pos);
            state.agents[i].carrying += 1;
        }

        // A large seed is picked up, not consumed: it stays a distinct object the
        // raider is hauling, so a tag can drop it back whole. Only the raiding side
        // can take it — its own colony walking over it is recalling it, not eating it
        // (that is the drift/recall phase's business, not this one).
        for seed_idx in 0..state.large_seeds.len() {
            let seed = &state.large_seeds[seed_idx];
            if seed.half == enemy_half && seed.on_board() && seed.pos == pos {
                state.large_seeds[seed_idx].carried_by = Some(i);
                state.large_seeds[seed_idx].recall_accum = 0;
                state.agents[i].carrying_large += 1;
            }
        }
    }
}

/// Phase 4 — tagging. Settle every tile two enemies share, under the one rule the
/// module doc spells out: an immune ant cannot be killed, and kills any non-immune
/// enemy it meets; absent jelly, the soldier kills the raider.
fn tagging(board: &Board, state: &mut MatchState, cancelled_swaps: &[(usize, usize)]) {
    // Decide every tag from ONE read-only snapshot, then apply. This is what makes
    // simultaneous kills order-independent: a soldier sharing a tile with both an
    // immune raider and a plain one kills the plain raider *and* dies to the immune
    // one, in the same tick. Applying as we went would let whichever agent we
    // happened to visit first respawn out from under the other — an agent-ordering
    // dependency, which in a replay-reconstructed engine is a silent desync.
    let mut to_respawn: Vec<(usize, Pos, Team, Role, u32)> = Vec::new();

    // Two enemies are *engaged* if they share a tile, or if they just tried to trade
    // tiles and [`movement`] cancelled it. The second case is what stops a cancelled
    // swap from becoming a permanent standoff: the pair never shares a tile, so
    // without this they would face each other forever, neither able to move.
    let swapped_with = |a: usize, b: usize| {
        cancelled_swaps
            .iter()
            .any(|&(i, j)| (i == a && j == b) || (i == b && j == a))
    };

    for victim_idx in 0..state.agents.len() {
        let victim = &state.agents[victim_idx];
        // Jelly is absolute protection: an immune ant is never a victim.
        if victim.immune_ticks > 0 {
            continue;
        }
        let victim_role = victim.role(board);
        // An engaged enemy is, by the positional role rule, always the opposite role
        // to the victim — on a shared tile because the tile decides both roles, and
        // on a cancelled swap because that is the only swap movement cancels. A
        // raider falls to *any* engaged enemy soldier; a soldier falls only to an
        // engaged enemy raider carrying active jelly.
        let tagged = state.agents.iter().enumerate().any(|(other_idx, other)| {
            if other.team == victim.team {
                return false;
            }
            if other.pos != victim.pos && !swapped_with(victim_idx, other_idx) {
                return false;
            }
            match victim_role {
                Role::Raider => true,
                Role::Soldier => other.immune_ticks > 0,
            }
        });
        if tagged {
            to_respawn.push((
                victim_idx,
                victim.pos,
                victim.team,
                victim_role,
                victim.carrying,
            ));
        }
    }

    for &(_, _, victim_team, _, _) in &to_respawn {
        // Every tag is one kill credited to the colony that did the tagging — the
        // victim's opponent, whichever role each side was playing.
        state.kills.add(victim_team.opponent(), 1);
    }

    for (idx, tag_tile, victim_team, victim_role, load) in to_respawn {
        // Only a raider can be holding anything worth dropping. A soldier's load is
        // always zero here because banking runs first (see the module doc), so a
        // returning carrier has already scored — there is no case where a soldier
        // dies holding seeds it took from the *other* half.
        if victim_role == Role::Raider && load > 0 {
            // Scatter the dropped load onto the maze as recoverable caches on the
            // defender's territory (the half the raid happened on). Each carried
            // seed becomes a cache; they lay out from the tag tile (a set, so a
            // single tile holds at most one cache — matching tile-locked caches).
            let defender_half = victim_team.opponent();
            scatter_dropped_load(board, state, defender_half, tag_tile, load);
        }
        // A large seed the victim was hauling drops back onto the board WHOLE at the
        // tag tile — still one object worth `large_seed_value`, not that many
        // ordinary caches. It resumes drifting from wherever it landed (its home, and
        // so its recall guard, is unchanged), which makes running down a big-seed
        // carrier a genuinely good defensive play: you get the object back, deep in
        // your own territory, and the clock on it starts again.
        for seed in state.large_seeds.iter_mut() {
            if seed.carried_by == Some(idx) {
                seed.carried_by = None;
                seed.pos = tag_tile;
                seed.drift_accum = 0;
                seed.recall_accum = 0;
            }
        }

        // Respawn the tagged ant at its nest with nothing carried; reset its charge.
        let nest = board.nest(victim_team);
        let agent = &mut state.agents[idx];
        agent.pos = nest;
        agent.carrying = 0;
        agent.carrying_large = 0;
        agent.move_accum = 0;
    }
}

/// Phase 6 — the large seeds: drift, and recall.
///
/// **Drift** happens regardless of who is standing on the seed. That is deliberate
/// and it is the mechanic's whole defensive property: an ordinary cache can be
/// denied forever by a soldier parked on it, but a large seed simply walks out from
/// under a squatter. A defender who wants it back has to *do* something.
///
/// Nothing but the border stops it. It walks until it cannot go on without crossing
/// and settles on the last column of its own half, so a seed left alone ends up on
/// the seam — one step from an enemy raider who can take it and bank it by stepping
/// straight home. It never crosses of its own accord: a seed is stolen by a raid,
/// never conceded by the clock.
///
/// **Recall** is that something: an ant of the seed's own colony stands on it for
/// `large_seed_recall_ticks` consecutive ticks and it snaps home. The guard —
/// `large_seed_recall_min_steps` of maze distance from home before a recall is legal
/// at all — closes the two ways this would otherwise be free. Without it an ant could
/// sit on the spawn tile and pin the seed there forever, or (the subtler hole) camp
/// one tile out and yo-yo the seed home the instant it arrived, keeping it
/// permanently out of reach at almost no cost. The defence has to let the seed get
/// out before it can pull it back.
fn large_seeds(board: &Board, state: &mut MatchState, rules: &Rules) {
    for seed_idx in 0..state.large_seeds.len() {
        if !state.large_seeds[seed_idx].on_board() {
            continue;
        }
        let seed = &state.large_seeds[seed_idx];
        let (half, pos, home) = (seed.half, seed.pos, seed.home);

        // Recall progress: any ant of the seed's own colony standing on it. Progress
        // is *consecutive* — it resets the moment nobody is there, so a recall has to
        // be seen through in one stint rather than accumulated in passing.
        let guarded = state
            .agents
            .iter()
            .any(|agent| agent.team == half && agent.pos == pos);
        let far_enough = state.large_seeds[seed_idx]
            .home_dist
            .get(&pos)
            .is_some_and(|d| *d >= rules.large_seed_recall_min_steps);

        if guarded && far_enough {
            let seed = &mut state.large_seeds[seed_idx];
            seed.recall_accum += 1;
            if seed.recall_accum >= rules.large_seed_recall_ticks {
                seed.pos = home;
                seed.recall_accum = 0;
                seed.drift_accum = 0;
                continue; // recalled home this tick; it does not also drift
            }
        } else {
            state.large_seeds[seed_idx].recall_accum = 0;
        }

        let Some(target) = state.large_seeds[seed_idx].target else {
            continue; // walls cut this seed off from the border; it never drifts
        };
        // A seed is at rest once it reaches its lane — which sits ON the border column,
        // so "at its lane" and "as far as it can possibly go" are the same place. It
        // cannot end up *past* the border: that is the enemy half, and only a raider
        // carries it there. So there is never anything to walk back from, and drift
        // never reverses. The only thing that moves a seed backwards is a *recall*,
        // and that costs a defender a walk out and a stand on it.
        //
        // Stopping at the column instead of the lane would re-open the pile-up: a seed
        // entering the column off its lane would halt on whatever tile the tunnel spat
        // it out on, and both seeds of a half would converge there again.
        if pos == target {
            continue;
        }

        // Drift one tile toward its lane every `large_seed_drift_ticks`. The step is
        // the first tile of a shortest path through the actual maze, so the seed
        // threads the tunnels rather than walking into a wall, and re-paths for itself
        // if it was dropped somewhere off its route.
        let seed = &mut state.large_seeds[seed_idx];
        seed.drift_accum += 1;
        if seed.drift_accum < rules.large_seed_drift_ticks {
            continue;
        }
        seed.drift_accum = 0;
        let from = seed.pos;
        let Some(next) = board.path_to(from, target, half).first().copied() else {
            continue;
        };
        // Two large seeds must never share a tile. They start on the same half and
        // drift toward the same border, so their paths converge — without this they
        // stack on the same rest tile and become, in play, a single 6-point object
        // that one raider scoops up in one step. A blocked seed simply holds and
        // tries again next cycle, which staggers them apart.
        let occupied = state
            .large_seeds
            .iter()
            .enumerate()
            .any(|(other_idx, other)| {
                other_idx != seed_idx && other.on_board() && other.pos == next
            });
        if !occupied {
            state.large_seeds[seed_idx].pos = next;
        }
    }
}

/// Scatter `load` dropped seeds onto recoverable caches near `tile` on
/// `defender_half`. Caches are tile-locked (one per tile), so we lay the load out
/// across the nearest free, passable defender-half tiles in a deterministic
/// outward ring from the tag tile. This keeps all dropped seeds in play — the
/// rule that "defending hands the seeds back to your side."
fn scatter_dropped_load(
    board: &Board,
    state: &mut MatchState,
    defender_half: Team,
    tile: Pos,
    load: u32,
) {
    let mut placed = 0u32;
    let mut radius = 0i32;
    // Spiral outward by Chebyshev ring; deterministic ordering keeps replays
    // reproducible. Bounded by the board size so a huge load cannot loop forever.
    let max_radius = board.width.max(board.height);
    while placed < load && radius <= max_radius {
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                // Only the outer ring at this radius (Chebyshev distance == radius).
                if dx.abs().max(dy.abs()) != radius {
                    continue;
                }
                let candidate = Pos::new(tile.x + dx, tile.y + dy);
                if !board.is_passable(candidate) {
                    continue;
                }
                if board.team_of_column(candidate.x) != defender_half {
                    continue; // dropped seeds stay on the defender's territory
                }
                if state.caches(defender_half).contains(&candidate) {
                    continue; // tile already holds a cache
                }
                state.caches_mut(defender_half).insert(candidate);
                placed += 1;
                if placed == load {
                    return;
                }
            }
        }
        radius += 1;
    }
}

/// Phase 3 — banking. A raider that crossed back onto its own half this tick banks
/// its whole load. `was_on_own_half` is the pre-movement snapshot.
fn banking(board: &Board, state: &mut MatchState, rules: &Rules, was_on_own_half: &[bool]) {
    // Bank into a scratch tally first so we are not borrowing `state.score`
    // mutably while iterating `state.agents` mutably.
    let mut banked: Vec<(Team, u32)> = Vec::new();
    let mut banked_by: Vec<usize> = Vec::new();
    for (i, (agent, was_home)) in state.agents.iter_mut().zip(was_on_own_half).enumerate() {
        // Banking is a *crossing*: was on the enemy half, now on its own half,
        // still carrying.
        let now_own_half = board.team_of_column(agent.pos.x) == agent.team;
        let load = agent.load(rules);
        if !was_home && now_own_half && load > 0 {
            banked.push((agent.team, load));
            agent.carrying = 0;
            if agent.carrying_large > 0 {
                agent.carrying_large = 0;
                banked_by.push(i);
            }
        }
    }
    // A banked large seed is out of play for good — the same fate as an eaten cache,
    // and what makes it count toward the sweep.
    for seed in state.large_seeds.iter_mut() {
        if seed
            .carried_by
            .is_some_and(|carrier| banked_by.contains(&carrier))
        {
            seed.banked = true;
            seed.carried_by = None;
        }
    }
    for (team, load) in banked {
        state.score.add(team, load);
    }
}

/// Phase 5 — jelly. A raider ending on an active jelly node consumes it for `J`
/// ticks of immunity, and the node begins regrowing at that same tile.
fn jelly(board: &Board, state: &mut MatchState, rules: &Rules) {
    for i in 0..state.agents.len() {
        let agent = &state.agents[i];
        if agent.role(board) != Role::Raider {
            continue;
        }
        // Jelly nodes sit on the half being raided (the enemy half to this agent).
        let enemy_half = agent.team.opponent();
        let pos = agent.pos;
        if state.jelly(enemy_half).contains(&pos) {
            state.jelly_mut(enemy_half).remove(&pos);
            // The node is spent, not gone: it regrows at its own tile. A node is in
            // exactly one of the active set or the regrowing map, never both.
            state
                .jelly_regrowing_mut(enemy_half)
                .insert(pos, rules.jelly_respawn_ticks);
            // Set, not add: the overview grants a fresh `J`-tick window.
            state.agents[i].immune_ticks = rules.jelly_immunity_ticks;
        }
    }
}

/// Count the regrowing jelly nodes down and return the ripe ones to the active set.
/// A `jelly_respawn_ticks` of zero means a node comes back the very next tick; the
/// node always returns to the tile it was eaten from, so the board's jelly layout is
/// fixed for the whole match and a controller can plan around it.
fn regrow_jelly(state: &mut MatchState) {
    for team in [Team::Red, Team::Blue] {
        let mut ripe: Vec<Pos> = Vec::new();
        for (pos, remaining) in state.jelly_regrowing_mut(team).iter_mut() {
            *remaining = remaining.saturating_sub(1);
            if *remaining == 0 {
                ripe.push(*pos);
            }
        }
        for pos in ripe {
            state.jelly_regrowing_mut(team).remove(&pos);
            state.jelly_mut(team).insert(pos);
        }
    }
}

/// Evaluate win conditions after a tick. A sweep (one colony has banked *all* of
/// the enemy's seeds) ends the match immediately; otherwise the `max_ticks` cap
/// ends it on banked score, equal being a draw.
fn decide(state: &MatchState, sim: &Simulation) -> Option<MatchResult> {
    // Sweep: a colony wins when it has banked every seed that started on the
    // opponent's half. Red sweeps Blue when Red's banked count reaches Blue's
    // original total, and vice versa. Banked seeds only ever come from the
    // opponent's half, so the banked score *is* the swept count.
    for team in [Team::Red, Team::Blue] {
        let opponent = team.opponent();
        if state.seeds_total(opponent) > 0 && state.score.get(team) >= state.seeds_total(opponent) {
            return Some(MatchResult {
                winner: Some(team),
                score: state.score,
                kills: state.kills,
                ended: Ended::Swept,
                ticks: state.tick,
            });
        }
    }

    if state.tick >= sim.max_ticks {
        let winner = match state.score.red.cmp(&state.score.blue) {
            std::cmp::Ordering::Greater => Some(Team::Red),
            std::cmp::Ordering::Less => Some(Team::Blue),
            std::cmp::Ordering::Equal => None,
        };
        return Some(MatchResult {
            winner,
            score: state.score,
            kills: state.kills,
            ended: Ended::TimeLimit,
            ticks: state.tick,
        });
    }

    None
}

/// Force a forfeit result for `loser` at the current tick. The engine never calls
/// this — the host does, when a controller traps, exhausts fuel/memory, or emits
/// a contract-invalid action — but it lives here so the forfeit outcome is built
/// the same way every other result is. The non-forfeiting team wins.
pub fn forfeit(state: &mut MatchState, loser: Team) -> MatchResult {
    let result = MatchResult {
        winner: Some(loser.opponent()),
        score: state.score,
        kills: state.kills,
        ended: Ended::Forfeit,
        ticks: state.tick,
    };
    state.result = Some(result);
    result
}
