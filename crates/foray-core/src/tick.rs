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
//!    Two agents may never *swap* tiles in one tick (no passing through another
//!    agent); such a move is cancelled and both hold.
//! 2. **Eating.** A raider that ends the tick on an enemy seed cache consumes it
//!    into its carried load.
//! 3. **Tagging.** A soldier sharing a tile with an enemy raider on the
//!    soldier's own half tags it: the raider respawns at its nest and its carried
//!    load scatters onto the maze at the tag tile as recoverable caches. A raider
//!    with `immune_ticks > 0` cannot be tagged.
//! 4. **Banking.** A raider that crossed back onto its own half this tick adds
//!    its entire load to the team score and resets the load to zero.
//! 5. **Jelly.** A raider that ends the tick on an active royal-jelly node
//!    consumes it and gains `J` ticks of immunity.
//!
//! Then immunity decrements and win conditions are checked. Because tagging
//! precedes banking, a raider caught on the border seam loses its load rather
//! than banking it; because eating precedes tagging, a raider can be tagged on
//! the very tile it just ate — both are intentional.

use crate::board::{Board, Pos, Team};
use crate::config::{Rules, Simulation};
use crate::contract::Action;
use crate::state::{Ended, MatchResult, MatchState, Role};

/// Advance `state` by one tick, applying `red`'s and `blue`'s actions. The
/// actions are assumed already contract-valid (the host validates and substitutes
/// `Action::all_stop` on a forfeit before calling this); this function only ever
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
    tagging(board, state);
    banking(board, state, &was_on_own_half);
    jelly(board, state, rules);

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

    // Forbid position swaps. Two agents may *share* a tile, so moving onto another
    // agent is fine — but two agents exchanging tiles in one tick would let each
    // pass *through* the other (a soldier and an enemy raider trading places never
    // share a tile, so the raider would slip past untagged). Cancel any such swap:
    // both agents hold, and the interaction (a tag, say) happens on a later tick.
    for i in 0..n {
        if !moved[i] {
            continue;
        }
        for j in (i + 1)..n {
            if moved[j] && targets[i] == from[j] && targets[j] == from[i] {
                targets[i] = from[i];
                moved[i] = false;
                targets[j] = from[j];
                moved[j] = false;
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

/// Phase 3 — tagging. A soldier co-located with an enemy raider on the soldier's
/// own half respawns that raider and scatters its load.
fn tagging(board: &Board, state: &mut MatchState) {
    // Collect tags first (reads), then apply (writes), so the set of taggers and
    // victims is decided from one consistent snapshot. A raider can be tagged by
    // at most one soldier per tick; once respawned it is no longer co-located.
    let mut to_respawn: Vec<(usize, Pos, Team, u32)> = Vec::new(); // (idx, tag tile, raider team, load)

    for victim_idx in 0..state.agents.len() {
        let victim = &state.agents[victim_idx];
        if victim.role(board) != Role::Raider || victim.immune_ticks > 0 {
            continue; // only an exposed enemy raider is taggable
        }
        // Is any enemy soldier sharing this tile? The soldier must be on its own
        // half — which is exactly the victim's current (enemy-to-the-victim) half.
        let tagged = state.agents.iter().any(|s| {
            s.team != victim.team && s.role(board) == Role::Soldier && s.pos == victim.pos
        });
        if tagged {
            to_respawn.push((victim_idx, victim.pos, victim.team, victim.carrying));
        }
    }

    for &(_, _, raider_team, _) in &to_respawn {
        // The taggers are the raider's opponents (the soldiers on this half); each
        // respawned raider is one kill credited to that defending colony.
        state.kills.add(raider_team.opponent(), 1);
    }

    for (idx, tag_tile, raider_team, load) in to_respawn {
        // Scatter the dropped load onto the maze as recoverable caches on the
        // defender's territory (the half the raid happened on). Each carried seed
        // becomes a cache; they pile onto the tag tile (a set, so a single tile
        // holds at most one cache — extra load beyond one seed re-enters as the
        // single recoverable cache at that tile, matching tile-locked caches).
        let defender_half = raider_team.opponent();
        if load > 0 {
            scatter_dropped_load(board, state, defender_half, tag_tile, load);
        }
        // Respawn the raider at its nest with nothing carried; reset its charge.
        let nest = board.nest(raider_team);
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
/// ticks of immunity.
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
            // Set, not add: the overview grants a fresh `J`-tick window.
            state.agents[i].immune_ticks = rules.jelly_immunity_ticks;
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
