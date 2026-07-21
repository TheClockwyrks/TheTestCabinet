//! `border-soldier` — a token balance, and the strongest baseline.
//!
//! A naive "balanced" split. It **statically** assigns the first
//! `DEFENDERS` agents (by id) to defence and sends the rest in as
//! `greedy-raider`-style foragers. A defender chases the **nearest visible
//! intruder** — an enemy raider standing on our own half — and, when there is none,
//! **patrols the border** on our side so it is positioned to intercept the next
//! crossing. A forager beelines to the nearest enemy seed cache and banks when
//! nothing is reachable, exactly like `greedy-raider`.
//!
//! Its weakness, per references.md, is that the split **never adapts**: the same
//! agents defend and raid every tick regardless of the match. It does not reinforce
//! a defence that is being overrun, recall a laden raider to bank before it is
//! caught, reason about royal jelly at all, or weigh a raider's load against its
//! distance home. A controller that re-allocates its three agents to the actual
//! match state takes it apart.

use foray_controller_sdk::controller;
use foray_controller_sdk::grid::Grid;
use foray_controller_sdk::util::{act, forage_or_bank, step_to_nearest};
use foray_core::contract::{EnemyAgentView, OwnAgentView};
use foray_core::{Action, Dir, Role, Team, World};

/// How many of the three agents are statically assigned to defence. Fixed for the
/// whole match — the rigidity references.md calls out. One defender, two foragers
/// keeps the offence that makes this the strongest baseline while still holding the
/// border, and stays within the "one or two" the doc describes.
const DEFENDERS: u32 = 1;

/// The load a forager piles on before turning home — the same blunt, carry-weight-
/// ignoring capacity `greedy-raider` uses (references.md: its foragers are
/// "greedy-raider-style").
const CARRY_CAP: u32 = 6;

/// Assign each agent its fixed job by id and act on it.
fn decide(world: &World) -> Action {
    let grid = Grid::from_world(world);

    // The enemy half's caches, pre-filtered once for the foragers (mirrors
    // `greedy-raider`).
    let enemy_caches: Vec<(i32, i32)> = world
        .seeds
        .iter()
        .map(|s| (s[0], s[1]))
        .filter(|&(x, _)| !grid.is_own_half(world.team, x))
        .collect();

    act(world, |agent| {
        // The static role split: ids below the threshold defend, the rest raid.
        // Never reconsidered, whatever the match looks like.
        if agent.id < DEFENDERS {
            defend(&grid, world, agent)
        } else {
            forage_or_bank(&grid, world.team, agent, &enemy_caches, CARRY_CAP)
        }
    })
}

/// A defender's move: chase the nearest intruder on our half, else patrol the
/// border. It only ever acts as a soldier on home turf — it never crosses to raid,
/// even when the home half is clear (the rigidity is the point).
fn defend(grid: &Grid, world: &World, agent: &OwnAgentView) -> Dir {
    // An intruder is an enemy whose role is `Raider` — by definition standing on
    // our half, where this soldier can tag it. Chase the nearest reachable one.
    let intruders: Vec<(i32, i32)> = world
        .enemies
        .iter()
        .filter(|e: &&EnemyAgentView| e.role == Role::Raider)
        .map(|e| (e.x, e.y))
        .collect();
    if !intruders.is_empty() {
        let chase = step_to_nearest(grid, (agent.x, agent.y), &intruders);
        if chase != Dir::Stop {
            return chase;
        }
    }
    // No reachable intruder: hold the line. Patrol toward the home-side border
    // column so the defender sits where the next raider must cross.
    patrol(grid, world.team, agent)
}

/// Step toward the home-side column adjacent to the border, the defender's resting
/// post. From there it is one tile from intercepting a fresh crossing.
fn patrol(grid: &Grid, team: Team, agent: &OwnAgentView) -> Dir {
    // The last column on our own half before the seam: `border_x - 1` for Red,
    // `border_x` for Blue.
    let post_x = match team {
        Team::Red => grid.border_x() - 1,
        Team::Blue => grid.border_x(),
    };
    if agent.x == post_x {
        // Already on the patrol column; hold rather than wander off it.
        return Dir::Stop;
    }
    grid.step_toward(agent.x, agent.y, |x, _| x == post_x)
        .unwrap_or(Dir::Stop)
}

controller!(decide);
