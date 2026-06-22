//! `foray-fuel-probe` — an internal calibration adversary, **not** a shipped
//! baseline.
//!
//! This controller exists for one purpose: to be a *genuinely competent* Foray
//! controller — the kind a capable model would write — so we can measure the
//! per-tick wasmtime fuel a real submission consumes and confirm the case's
//! `[sandbox] fuel_per_tick` ceiling is generous rather than cramped. It is built
//! to wasm and pitted against the three `foray-ref-*` baselines (`random`,
//! `greedy-raider`, `border-soldier`); it beats all three, and the fuel it burns
//! per tick is the calibration number.
//!
//! It is deliberately kept out of the case definition (no manifest reference, not
//! seeded into the run container, not a `foray-ref-*` crate) so it never leaks a
//! worked strong solution to a model. See the crate `Cargo.toml` header.
//!
//! ## Strategy (why it beats the baselines)
//!
//! The shipped baselines each embody one rigidity the case teaches:
//! `greedy-raider` never defends and over-loads into easy tags; `border-soldier`
//! splits its three agents *statically* (one defender, two over-loading foragers)
//! and never re-allocates. This controller fixes both, and the whole thing is a
//! *race*: banking seeds wins, tagging only denies, so it leans offence and
//! defends just enough.
//!
//! 1. **Light-load banking.** A raider carrying at most `light_load` (3) earns the
//!    full move charge every tick, so it strictly out-paces any soldier and is
//!    effectively uncatchable in the open. Foragers grab up to that cap and bank,
//!    trading a little throughput per trip for near-zero losses.
//! 2. **Defender-aware pathfinding.** A forager's BFS treats tiles held by enemy
//!    *soldiers* as blocked, so it routes its raid and its run home *around* a
//!    camped defender instead of walking onto it. This is the difference between
//!    scoring and being shut out: `border-soldier` parks a defender on the border
//!    seam, and a shortest-path raider that ignores it is tagged on every crossing.
//! 3. **Dynamic role re-allocation.** Every tick, agents are (re)assigned from the
//!    *actual* board: with no intruders everyone forages; when enemy raiders are on
//!    our half the cheapest-to-divert agent peels off to intercept the most-laden
//!    one (the slow, easy-to-catch over-loader the baselines produce). The split is
//!    never fixed — the adaptation `border-soldier` lacks.

use std::collections::{HashSet, VecDeque};

use foray_controller_sdk::controller;
use foray_controller_sdk::grid::Grid;
use foray_controller_sdk::util::act;
use foray_core::contract::OwnAgentView;
use foray_core::{Action, Dir, Role, Team, World};

/// Carry cap before a forager turns for home: `light_load` (3). At or below it a
/// raider moves every tick — strictly faster than a soldier — so it cannot be run
/// down in the open. Banking here keeps every trip safe and fast.
const LIGHT_CAP: u32 = 3;

/// Foragers to keep on offence while there is anything left to raid. Banking wins
/// the race, so we hold two raiders out and spare at most one agent for defence.
const MIN_FORAGERS: usize = 2;

/// Don't divert an agent more than this many BFS tiles to chase an intruder.
const DEFEND_RANGE: u32 = 22;

/// The four cardinal steps, in the grid's fixed tie-break order.
const STEPS: [(Dir, i32, i32); 4] = [
    (Dir::N, 0, -1),
    (Dir::S, 0, 1),
    (Dir::E, 1, 0),
    (Dir::W, -1, 0),
];

/// Extra diversion cost charged to an agent that is *mid-raid* (a laden raider deep
/// on the enemy half), so a home-side soldier is preferred for defence.
fn divert_penalty(agent: &OwnAgentView) -> u32 {
    match agent.role {
        Role::Soldier => 0,
        Role::Raider => 8 + agent.carrying * 4,
    }
}

fn decide(world: &World) -> Action {
    let grid = Grid::from_world(world);
    let team = world.team;

    let enemy_caches: Vec<(i32, i32)> = world
        .seeds
        .iter()
        .map(|s| (s[0], s[1]))
        .filter(|&(x, _)| !grid.is_own_half(team, x))
        .collect();

    // Tiles a *raider* of ours must not step onto: any enemy soldier (an enemy on
    // its own half, where it can tag us). Standing on one ends the tick co-located
    // with a tagger, so our raid/return BFS treats them as walls and detours.
    let soldier_tiles: HashSet<(i32, i32)> = world
        .enemies
        .iter()
        .filter(|e| e.role == Role::Soldier)
        .map(|e| (e.x, e.y))
        .collect();

    // Intruders worth chasing: enemy raiders on our half that aren't immune,
    // most-laden first (most score to deny, slowest to flee).
    let intruders: Vec<(i32, i32)> = {
        let mut v: Vec<&foray_core::contract::EnemyAgentView> = world
            .enemies
            .iter()
            .filter(|e| e.role == Role::Raider && e.immune_ticks == 0)
            .collect();
        v.sort_by_key(|e| std::cmp::Reverse(e.carrying));
        v.into_iter().map(|e| (e.x, e.y)).collect()
    };

    let squad = world.my_agents.len();
    let max_defenders = if enemy_caches.is_empty() {
        squad
    } else {
        squad.saturating_sub(MIN_FORAGERS)
    };

    // Greedy defender assignment: each intruder (priority order) gets the cheapest
    // free agent within range. Defenders are soldiers on home turf, so their chase
    // BFS needs no enemy-soldier avoidance.
    let mut assignment: Vec<Option<(i32, i32)>> = vec![None; squad];
    let mut assigned = 0usize;
    let no_avoid: HashSet<(i32, i32)> = HashSet::new();
    for &(ix, iy) in intruders.iter() {
        if assigned >= max_defenders {
            break;
        }
        let mut best: Option<(usize, u32)> = None;
        for (i, agent) in world.my_agents.iter().enumerate() {
            if assignment[i].is_some() {
                continue;
            }
            let Some(dist) = bfs(&grid, (agent.x, agent.y), &no_avoid, |x, y| {
                x == ix && y == iy
            })
            .map(|(_, d)| d) else {
                continue;
            };
            if dist > DEFEND_RANGE {
                continue;
            }
            let cost = dist + divert_penalty(agent);
            if best.map(|(_, c)| cost < c).unwrap_or(true) {
                best = Some((i, cost));
            }
        }
        if let Some((i, _)) = best {
            assignment[i] = Some((ix, iy));
            assigned += 1;
        }
    }

    act(world, |agent| {
        let i = agent.id as usize;
        match assignment.get(i).copied().flatten() {
            Some(target) => {
                // Chase the intruder; the chaser is a soldier and can't be tagged,
                // so it ignores the avoidance set.
                bfs(&grid, (agent.x, agent.y), &no_avoid, |x, y| {
                    x == target.0 && y == target.1
                })
                .map(|(dir, _)| dir)
                .unwrap_or(Dir::Stop)
            }
            None => forage(&grid, team, agent, &enemy_caches, &soldier_tiles),
        }
    })
}

/// A forager's step: bank at the light cap, else head for the nearest reachable
/// cache — both routed around enemy soldiers so a camped defender can't tag us.
fn forage(
    grid: &Grid,
    team: Team,
    agent: &OwnAgentView,
    enemy_caches: &[(i32, i32)],
    avoid: &HashSet<(i32, i32)>,
) -> Dir {
    let from = (agent.x, agent.y);
    if agent.carrying >= LIGHT_CAP {
        return step_home(grid, team, from, avoid);
    }
    if let Some((dir, _)) = bfs(grid, from, avoid, |x, y| {
        enemy_caches.iter().any(|&(cx, cy)| cx == x && cy == y)
    }) {
        return dir;
    }
    // No cache reachable without crossing a defender: carry what we have home.
    step_home(grid, team, from, avoid)
}

/// Step toward our own half (to bank), routing around enemy soldiers.
fn step_home(grid: &Grid, team: Team, from: (i32, i32), avoid: &HashSet<(i32, i32)>) -> Dir {
    bfs(grid, from, avoid, |x, _| grid.is_own_half(team, x))
        .map(|(dir, _)| dir)
        // Boxed in by walls and defenders: hold rather than walk onto a tagger.
        .unwrap_or(Dir::Stop)
}

/// Breadth-first search from `start` to the nearest tile satisfying `goal`, with
/// `avoid` tiles treated as impassable (enemy soldiers). Returns the first step of
/// the shortest such path and its length, or `None` if no path reaches a goal.
/// Ties break by the fixed N/S/E/W order, so paths are stable tick to tick.
fn bfs(
    grid: &Grid,
    start: (i32, i32),
    avoid: &HashSet<(i32, i32)>,
    goal: impl Fn(i32, i32) -> bool,
) -> Option<(Dir, u32)> {
    let (sx, sy) = start;
    if goal(sx, sy) {
        return None;
    }
    let mut visited: HashSet<(i32, i32)> = HashSet::new();
    visited.insert((sx, sy));
    let mut queue: VecDeque<(i32, i32, Dir, u32)> = VecDeque::new();
    for (dir, dx, dy) in STEPS {
        let (nx, ny) = (sx + dx, sy + dy);
        if grid.is_passable(nx, ny) && !avoid.contains(&(nx, ny)) && visited.insert((nx, ny)) {
            if goal(nx, ny) {
                return Some((dir, 1));
            }
            queue.push_back((nx, ny, dir, 1));
        }
    }
    while let Some((x, y, first, dist)) = queue.pop_front() {
        for (_, dx, dy) in STEPS {
            let (nx, ny) = (x + dx, y + dy);
            if grid.is_passable(nx, ny) && !avoid.contains(&(nx, ny)) && visited.insert((nx, ny)) {
                if goal(nx, ny) {
                    return Some((first, dist + 1));
                }
                queue.push_back((nx, ny, first, dist + 1));
            }
        }
    }
    None
}

controller!(decide);
