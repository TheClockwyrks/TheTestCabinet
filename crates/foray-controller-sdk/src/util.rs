//! Small shared helpers the reference controllers compose: assembling a contract
//! [`Action`] from per-agent decisions and a deterministic step toward the nearest
//! tile in a set.

use foray_core::contract::OwnAgentView;
use foray_core::{Action, Dir, Move, World};

use crate::grid::Grid;

/// Build the team's [`Action`] for the tick by calling `choose` for each owned
/// agent in `world.my_agents`. This guarantees exactly the owned agent ids appear,
/// each once — the structural rule the host forfeits over — so a controller never
/// has to assemble the move list by hand or risk omitting an agent.
///
/// `choose` returns the direction the agent should attempt; the host clamps a move
/// that is blocked or that the carry-weight cadence stalls this tick, so a
/// controller may freely return its intended direction without re-checking either.
pub fn act<F>(world: &World, mut choose: F) -> Action
where
    F: FnMut(&OwnAgentView) -> Dir,
{
    let moves = world
        .my_agents
        .iter()
        .map(|agent| Move {
            agent: agent.id,
            dir: choose(agent),
        })
        .collect();
    Action { moves }
}

/// Step one tile toward the nearest passable target tile in `targets` (by true
/// maze distance), or `Stop` if the set is empty or none is reachable.
///
/// The "nearest" target is chosen by BFS distance, then the path to it is walked
/// one step. Targets are pre-filtered to passable tiles so an unreachable goal
/// (e.g. a cache the controller's stale view places on a wall) never strands the
/// agent. Both the distance and step BFS break ties by the grid's fixed neighbour
/// order, so the choice is stable tick to tick.
pub fn step_to_nearest(grid: &Grid, from: (i32, i32), targets: &[(i32, i32)]) -> Dir {
    let (sx, sy) = from;
    let goal = |x: i32, y: i32| targets.iter().any(|&(tx, ty)| tx == x && ty == y);
    if !targets.iter().any(|&(x, y)| grid.is_passable(x, y)) {
        return Dir::Stop;
    }
    grid.step_toward(sx, sy, goal).unwrap_or(Dir::Stop)
}

/// Step one tile toward `team`'s own half — i.e. back across the border to bank a
/// load — from `(x, y)`. Returns `Stop` if already home or boxed in.
///
/// Used by every raider that wants to bank: the goal is "any passable tile on my
/// own half", and the BFS finds the shortest route to the border seam and across.
pub fn step_home(grid: &Grid, team: foray_core::Team, x: i32, y: i32) -> Dir {
    grid.step_toward(x, y, |gx, _| grid.is_own_half(team, gx))
        .unwrap_or(Dir::Stop)
}

/// The pure-greed forage loop the `greedy-raider` and `border-soldier` foragers
/// share: grab seeds until the agent "can carry no more", then crawl the whole
/// load home to bank it (references.md).
///
/// `carry_cap` is the load at which the forager stops reaching for new caches and
/// turns for home. Greed is in the *over-loading*: the cap is generous, so the
/// raider routinely carries a heavy load and is slowed by carry weight on the way
/// back — the easy-tag weakness the case teaches. It does **not** read the
/// carry-weight cadence to break off early; that optimization is exactly what the
/// baselines omit.
///
/// While still under the cap it beelines to the nearest enemy cache; once at or
/// over the cap (or with no cache reachable) it heads home, still eating any cache
/// it happens to cross on the way. `Stop` only when truly boxed in on both goals.
pub fn forage_or_bank(
    grid: &Grid,
    team: foray_core::Team,
    agent: &OwnAgentView,
    enemy_caches: &[(i32, i32)],
    carry_cap: u32,
) -> Dir {
    if agent.carrying < carry_cap {
        let toward_seed = step_to_nearest(grid, (agent.x, agent.y), enemy_caches);
        if toward_seed != Dir::Stop {
            return toward_seed;
        }
    }
    // At capacity, or nothing left to reach: carry the load home to bank it.
    step_home(grid, team, agent.x, agent.y)
}
