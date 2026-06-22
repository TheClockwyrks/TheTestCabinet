//! `trace` — an internal calibration diagnostic (paired with the `foray-fuel-probe`
//! crate), not part of the shipped product.
//!
//! It runs two controller wasm modules tick by tick and prints the score plus a
//! per-agent snapshot at intervals, so a maintainer can see *why* a match does or
//! does not progress — e.g. spotting a border deadlock that yields a 0–0 draw, or
//! watching where a controller gets shut out. Used while tuning the case's rules
//! and per-tick fuel ceiling.
//!
//! Run: cargo run --release --example trace -p foray-host -- RED.wasm BLUE.wasm [SEED] [EVERY] [STOP]

use foray_core::Team;
use foray_core::board::Board;
use foray_core::config::{BoardParamsSerde, Rules, Simulation};
use foray_core::contract::Action;
use foray_core::engine::Match;
use foray_host::{Controller, SandboxLimits};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let red_path = &args[1];
    let blue_path = &args[2];
    let seed: u64 = args.get(3).map(|s| s.parse().unwrap()).unwrap_or(15739460);
    let every: u32 = args.get(4).map(|s| s.parse().unwrap()).unwrap_or(50);
    let stop: u32 = args.get(5).map(|s| s.parse().unwrap()).unwrap_or(u32::MAX);

    let params = BoardParamsSerde::default();
    let board = Board::generate("mirror-32x16", params.into(), seed);
    let rules = Rules::default();
    let sim = Simulation::default();

    let engine = {
        let mut cfg = wasmtime::Config::new();
        cfg.consume_fuel(true);
        wasmtime::Engine::new(&cfg).unwrap()
    };
    let limits = SandboxLimits {
        fuel_per_tick: 2_000_000_000,
        max_memory_bytes: 256 * 1024 * 1024,
    };
    let red_wasm = std::fs::read(red_path).unwrap();
    let blue_wasm = std::fs::read(blue_path).unwrap();
    let mut red = Controller::load(&engine, &red_wasm, "tick", limits).unwrap();
    let mut blue = Controller::load(&engine, &blue_wasm, "tick", limits).unwrap();

    let mut game = Match::new(board, rules, sim);
    let mut first_bank: Option<(u32, Team, u32)> = None;
    let mut last_score = game.state.score;

    while !game.is_over() && game.state.tick < stop {
        let rw = game.observe(Team::Red).to_json();
        let bw = game.observe(Team::Blue).to_json();
        let ra: Action = serde_json::from_slice(&red.invoke(&rw).unwrap()).unwrap();
        let ba: Action = serde_json::from_slice(&blue.invoke(&bw).unwrap()).unwrap();
        game.step(&ra, &ba);

        let s = game.state.score;
        if first_bank.is_none() && (s.red > 0 || s.blue > 0) {
            let (team, amt) = if s.red > 0 {
                (Team::Red, s.red)
            } else {
                (Team::Blue, s.blue)
            };
            first_bank = Some((game.state.tick, team, amt));
        }
        if game.state.tick.is_multiple_of(every) && game.state.tick <= every * 12 {
            let snap = game.snapshot();
            let ags: Vec<String> = snap
                .agents
                .iter()
                .map(|a| {
                    format!(
                        "{:?}{}@({:>2},{:>2}){}c{}{}",
                        a.team,
                        a.id,
                        a.x,
                        a.y,
                        match a.role {
                            foray_core::Role::Soldier => "S",
                            foray_core::Role::Raider => "R",
                        },
                        a.carrying,
                        if a.immune_ticks > 0 {
                            format!("i{}", a.immune_ticks)
                        } else {
                            String::new()
                        },
                    )
                })
                .collect();
            println!(
                "t{:>5} score {}-{} | {}",
                snap.tick,
                s.red,
                s.blue,
                ags.join("  ")
            );
        }
        if s != last_score {
            println!(">> t{} BANK score {}-{}", game.state.tick, s.red, s.blue);
            last_score = s;
        }
    }
    let r = game.result().unwrap();
    println!(
        "RESULT {:?} score {}-{} kills {}-{} ticks {} | first_bank {:?}",
        r.ended, r.score.red, r.score.blue, r.kills.red, r.kills.blue, r.ticks, first_bank
    );
}
