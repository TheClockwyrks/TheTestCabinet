//! `greedy-raider` — all offence, no sense.
//!
//! Sends **every** owned agent to forage: each one beelines (shortest path, via the
//! SDK's BFS) toward the **nearest enemy seed cache**, eats whatever it reaches,
//! and heads home to bank only when **no enemy cache is reachable** (it has stripped
//! its reachable larder) or it is **boxed out**. It **never defends** — not one
//! agent is held back on the home half — and it **ignores carry weight** entirely:
//! it never breaks off a heavy load early, so it happily over-loads and crawls
//! home, an easy tag for any defender (references.md).
//!
//! Both omissions are deliberate: leaving the home caches completely undefended and
//! turning laden raiders into slow targets are the two lessons of the case, so this
//! baseline embodies the failure rather than hedging against it.

use foray_controller_sdk::controller;
use foray_controller_sdk::grid::Grid;
use foray_controller_sdk::util::{act, forage_or_bank};
use foray_core::{Action, World};

/// How much a forager piles on before it turns for home. Deliberately generous —
/// the greed is in the *over-loading*: by the time it heads back it is carrying
/// enough that carry weight has slowed it to a crawl, an easy tag for any defender
/// (references.md). It is **not** the carry-weight-aware break-off a good
/// controller would compute; it is a blunt "grab a big armful, then waddle home".
const CARRY_CAP: u32 = 6;

/// Drive every agent as a pure forager.
fn decide(world: &World) -> Action {
    let grid = Grid::from_world(world);
    // The caches this team raids are the ones on the *enemy* half — every cache
    // not on our own half, since the board has exactly two halves. Filter the
    // observation's full cache list down to those, once for the tick.
    let enemy_caches: Vec<(i32, i32)> = world
        .seeds
        .iter()
        .map(|s| (s[0], s[1]))
        .filter(|&(x, _)| !grid.is_own_half(world.team, x))
        .collect();

    act(world, |agent| {
        forage_or_bank(&grid, world.team, agent, &enemy_caches, CARRY_CAP)
    })
}

controller!(decide);
