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
//!    *through* the defender untagged; that swap is cancelled and both hold. Any
//!    other head-on swap (two soldiers crossing the seam, two raiders passing as
//!    each heads home) resolves, since no tag is at stake.
//! 2. **Eating.** A raider that ends the tick on an enemy seed cache consumes it
//!    into its carried load.
//! 3. **Banking.** A raider that crossed back onto its own half this tick adds
//!    its entire load to the team score and resets the load to zero.
//! 4. **Tagging.** Two enemies sharing a tile settle it. Because a role is decided
//!    purely by which half the tile is on, a shared tile is *always* one soldier
//!    (whose half it is) against one enemy raider — there is no other pairing. The
//!    outcome turns only on royal jelly:
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

    movement(board, state, red, blue, rules);
    eating(board, state);
    banking(board, state, &was_on_own_half);
    tagging(board, state);
    jelly(board, state, rules);
    regrow_jelly(state);

    // Immunity ticks down once per tick, after all phases that read it.
    for agent in &mut state.agents {
        agent.immune_ticks = agent.immune_ticks.saturating_sub(1);
    }

    let result = decide(state, sim);
    state.result = result;
    result
}

/// Phase 1 — movement under the carry-weight speed model.
fn movement(board: &Board, state: &mut MatchState, red: &Action, blue: &Action, rules: &Rules) {
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
    let role_at = |team: Team, pos: Pos| -> Role {
        if board.team_of_column(pos.x) == team {
            Role::Soldier
        } else {
            Role::Raider
        }
    };
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
}

/// Phase 2 — eating. A raider on an enemy cache consumes it into its load.
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
    }
}

/// Phase 4 — tagging. Settle every tile two enemies share, under the one rule the
/// module doc spells out: an immune ant cannot be killed, and kills any non-immune
/// enemy it meets; absent jelly, the soldier kills the raider.
fn tagging(board: &Board, state: &mut MatchState) {
    // Decide every tag from ONE read-only snapshot, then apply. This is what makes
    // simultaneous kills order-independent: a soldier sharing a tile with both an
    // immune raider and a plain one kills the plain raider *and* dies to the immune
    // one, in the same tick. Applying as we went would let whichever agent we
    // happened to visit first respawn out from under the other — an agent-ordering
    // dependency, which in a replay-reconstructed engine is a silent desync.
    let mut to_respawn: Vec<(usize, Pos, Team, Role, u32)> = Vec::new();

    for victim_idx in 0..state.agents.len() {
        let victim = &state.agents[victim_idx];
        // Jelly is absolute protection: an immune ant is never a victim.
        if victim.immune_ticks > 0 {
            continue;
        }
        let victim_role = victim.role(board);
        // Any enemy on this tile is, by the positional role rule, the opposite role
        // to the victim. A raider falls to *any* enemy soldier there; a soldier
        // falls only to an enemy raider carrying active jelly.
        let tagged = state.agents.iter().any(|other| {
            if other.team == victim.team || other.pos != victim.pos {
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
        // Respawn the tagged ant at its nest with nothing carried; reset its charge.
        let nest = board.nest(victim_team);
        let agent = &mut state.agents[idx];
        agent.pos = nest;
        agent.carrying = 0;
        agent.move_accum = 0;
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

/// Phase 4 — banking. A raider that crossed back onto its own half this tick
/// banks its whole load. `was_on_own_half` is the pre-movement snapshot.
fn banking(board: &Board, state: &mut MatchState, was_on_own_half: &[bool]) {
    // Bank into a scratch tally first so we are not borrowing `state.score`
    // mutably while iterating `state.agents` mutably.
    let mut banked = Vec::new();
    for (agent, was_home) in state.agents.iter_mut().zip(was_on_own_half) {
        // Banking is a *crossing*: was on the enemy half, now on its own half,
        // still carrying. (A tagged raider was respawned to its nest with load 0,
        // so even though it is now on its own half it banks nothing — exactly the
        // "killed before banking scores nothing" rule.)
        let now_own_half = board.team_of_column(agent.pos.x) == agent.team;
        if !was_home && now_own_half && agent.carrying > 0 {
            banked.push((agent.team, agent.carrying));
            agent.carrying = 0;
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
