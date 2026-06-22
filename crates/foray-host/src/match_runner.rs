//! The per-tick match loop: build each team's observation, invoke its controller,
//! validate the returned action, advance `foray-core` by one faked timestep, and
//! record the inputs into a [`Replay`].
//!
//! This is the reusable heart of the host. The `foray` CLI calls
//! [`run_match`](crate::run_match) (which sets up the engine and boards and
//! delegates here); the core `AdversarialValidator` will call the very same entry
//! to score a submission. Neither owns a rule — every rule lives in `foray-core`.

use foray_core::Team;
use foray_core::contract::{Action, ContractError};
use foray_core::engine::Match;
use foray_core::replay::{Participants, RecordHeader, Replay, TickInput};
use foray_core::state::{Ended, MatchResult};
use wasmtime::Engine;

use crate::controller::{Controller, InvokeError};
use crate::{FuelStats, MatchSetup, MatchSummary, RunError};

/// Drive one match to completion against two already-loaded controllers, recording
/// every tick's inputs and returning the published [`Replay`].
///
/// Each tick: observe → invoke → validate (per team), then advance the engine once
/// with both action sets. A controller that traps, runs out of fuel/memory, or
/// returns a contract-invalid action **forfeits** — its moves become all-`Stop`,
/// the *other* team is declared the winner by forfeit, and the loop stops — but
/// the inputs recorded so far still produce a playable replay.
///
/// The returned [`ForfeitInfo`] is `Some` exactly when the match ended on a
/// forfeit; it carries the tick and the offending team's [`ForfeitReason`] so a
/// caller can report *why* a controller lost. The recorded replay says only *that*
/// a forfeit happened, never the reason, so this is the only channel for it.
pub fn run_loaded_match(
    game: &mut Match,
    red: &mut Controller,
    blue: &mut Controller,
    setup: &MatchSetup,
) -> (Replay, Option<ForfeitInfo>) {
    let mut ticks: Vec<TickInput> = Vec::new();
    let mut result: Option<MatchResult> = None;
    let mut forfeit: Option<ForfeitInfo> = None;

    // The engine itself ends the match on a sweep or at `max_ticks` (its `decide`
    // returns a result on the final step), so the loop only has to run until the
    // engine reports it is over — a forfeit is the one ending the host decides.
    while !game.is_over() {
        // Decide both teams *before* advancing: each controller sees the same
        // pre-advance state, neither reacts to the other's move within a tick
        // (lockstep). A forfeit by either team ends the match this tick.
        let red_decision = decide(game, Team::Red, red);
        let blue_decision = decide(game, Team::Blue, blue);

        let (red_action, red_forfeit) = split(red_decision);
        let (blue_action, blue_forfeit) = split(blue_decision);

        ticks.push(TickInput {
            red: red_action.clone(),
            blue: blue_action.clone(),
        });

        if red_forfeit.is_some() || blue_forfeit.is_some() {
            result = Some(forfeit_result(
                game,
                red_forfeit.is_some(),
                blue_forfeit.is_some(),
            ));
            // Keep the offending team's reason(s) and the tick so the caller can
            // report *why* — the replay records only that a forfeit happened.
            forfeit = Some(ForfeitInfo {
                tick: game.state.tick,
                red: red_forfeit,
                blue: blue_forfeit,
            });
            break;
        }

        result = game.step(&red_action, &blue_action);
    }

    // `result` is always set once the loop exits: either the engine returned a
    // sweep/time-limit result on the final step, or a forfeit ended it. The
    // `unwrap_or_else` guards the impossible case where the match was already over
    // on entry, in which case the engine's stored result stands.
    let result = result
        .or(game.result())
        .expect("a finished match has a result");

    (Replay::record(record_header(setup), ticks, result), forfeit)
}

/// A controller's decision for one tick: either a contract-valid action, or a
/// forfeit carrying the reason and the all-`Stop` action recorded in its place.
enum Decision {
    Action(Action),
    Forfeit(Action, ForfeitReason),
}

/// Why a controller forfeited, kept for the recorded outcome and diagnostics. Its
/// [`Display`](std::fmt::Display) is a one-line, model-facing explanation (the
/// underlying invoke/contract error), so the `foray` CLI and the arena summary can
/// print *why* a controller lost.
#[derive(Debug, Clone, thiserror::Error)]
pub enum ForfeitReason {
    /// The invocation itself failed (trap, fuel, memory, bad region, bad JSON).
    #[error("{0}")]
    Invoke(#[source] InvokeError),
    /// The JSON parsed but was not a contract-valid action for the team.
    #[error("returned a contract-invalid action: {0}")]
    Contract(#[source] ContractError),
}

/// Which team(s) forfeited and why, returned alongside the replay when a match
/// ended on a forfeit. The replay's recorded [`Ended::Forfeit`] says only *that* a
/// forfeit decided the match; this carries the *reason*, which a caller reports
/// (the `foray` CLI prints it; the arena threads it into the summary `detail`).
#[derive(Debug, Clone)]
pub struct ForfeitInfo {
    /// The tick the forfeit occurred on.
    pub tick: u32,
    /// Red's forfeit reason, when Red forfeited this tick.
    pub red: Option<ForfeitReason>,
    /// Blue's forfeit reason, when Blue forfeited this tick.
    pub blue: Option<ForfeitReason>,
}

/// Observe `team`'s view, invoke its controller, and validate the result. Any
/// failure becomes a forfeit decision carrying all-`Stop` so the match can still
/// advance and a replay is produced.
fn decide(game: &Match, team: Team, controller: &mut Controller) -> Decision {
    let world = game.observe(team);
    let world_json = world.to_json();

    let bytes = match controller.invoke(&world_json) {
        Ok(bytes) => bytes,
        Err(err) => return Decision::Forfeit(Action::all_stop(), ForfeitReason::Invoke(err)),
    };

    let action: Action = match serde_json::from_slice(&bytes) {
        Ok(action) => action,
        Err(err) => {
            return Decision::Forfeit(
                Action::all_stop(),
                ForfeitReason::Invoke(InvokeError::BadJson(err.to_string())),
            );
        }
    };

    // Schema-shaped but structurally wrong (wrong agent id set, duplicates,
    // omissions) is a forfeit; a well-formed-but-blocked *move* is clamped to
    // Stop by the engine, not here (architecture.md's two legality tiers).
    if let Err(err) = action.validate_for(team, &game.state) {
        return Decision::Forfeit(Action::all_stop(), ForfeitReason::Contract(err));
    }

    Decision::Action(action)
}

/// Split a decision into the action to record and the forfeit reason, if any.
fn split(decision: Decision) -> (Action, Option<ForfeitReason>) {
    match decision {
        Decision::Action(action) => (action, None),
        Decision::Forfeit(action, reason) => (action, Some(reason)),
    }
}

/// Build the forfeit [`MatchResult`]: the non-forfeiting team wins; if *both*
/// forfeit on the same tick (e.g. two broken controllers) it is a forfeit draw.
/// The score is the current banked score, and `ticks` is the tick the forfeit
/// occurred on.
fn forfeit_result(game: &Match, red_forfeited: bool, blue_forfeited: bool) -> MatchResult {
    let winner = match (red_forfeited, blue_forfeited) {
        (true, false) => Some(Team::Blue),
        (false, true) => Some(Team::Red),
        // Both forfeited (or neither, which split() never produces here): a draw.
        _ => None,
    };
    MatchResult {
        winner,
        score: game.state.score,
        kills: game.state.kills,
        ended: Ended::Forfeit,
        ticks: game.state.tick,
    }
}

/// The replay header for this match's setup.
fn record_header(setup: &MatchSetup) -> RecordHeader {
    RecordHeader {
        map: setup.map_id.clone(),
        seed: setup.seed,
        participants: Participants {
            red: setup.red_id.clone(),
            blue: setup.blue_id.clone(),
        },
        board: setup.board_params,
        rules: setup.rules,
        sim: setup.sim,
    }
}

/// Load both controllers under a fresh engine and run the match. The engine has
/// fuel metering enabled (so per-tick fuel can be set) and is shared by both
/// controllers; each controller still gets its own [`Store`]/[`Instance`], so
/// their working memory is isolated.
pub fn run_with_modules(
    red_wasm: &[u8],
    blue_wasm: &[u8],
    mut game: Match,
    setup: &MatchSetup,
) -> Result<MatchSummary, RunError> {
    let engine = build_engine()?;

    let mut red = Controller::load(&engine, red_wasm, &setup.entry, setup.limits)
        .map_err(RunError::LoadRed)?;
    let mut blue = Controller::load(&engine, blue_wasm, &setup.entry, setup.limits)
        .map_err(RunError::LoadBlue)?;

    let (replay, forfeit) = run_loaded_match(&mut game, &mut red, &mut blue, setup);
    let fuel = FuelStats {
        ceiling: setup.limits.fuel_per_tick,
        red_peak: red.peak_fuel(),
        blue_peak: blue.peak_fuel(),
    };
    Ok(MatchSummary {
        replay,
        forfeit,
        fuel,
    })
}

/// Build the shared wasm engine with fuel metering on. Fuel consumption must be
/// enabled at engine-construction time for [`Store::set_fuel`] to work each tick.
fn build_engine() -> Result<Engine, RunError> {
    let mut config = wasmtime::Config::new();
    config.consume_fuel(true);
    Engine::new(&config).map_err(|e| RunError::Engine(e.to_string()))
}
