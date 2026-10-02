//! The pure decision cores behind coverage plans and ladders: **what to launch**
//! and **whether a rung is passed**.
//!
//! Everything in this module is deliberately free of the database, the HTTP
//! layer, and the wire types in [`crate::api`] — it takes plain counts
//! and [`Rating`](test_cabinet_core::review::Rating)s and returns a decision. Both
//! decisions **spend money** (one enqueues runs, the other decides whether a
//! climber keeps burning tokens on the next rung), so they are the two pieces that
//! must be exercised exhaustively without standing up a store; the transports that
//! call them do the reads, the writes, and the serialization.
//!
//! - [`schedule`] — the shared launch-pass algorithm. Given the cells of a plan (or
//!   the current rung slots of a ladder dispatch) in the order the owner chose, it
//!   answers which cells to launch and how many runs each, keeping the owner's jobs in
//!   flight under its runs-in-flight limit.
//! - [`gate`] — the single parameterised rung gate. Given the validators' ratings
//!   of a rung slot's counted runs and how many of its runs are still in flight, it
//!   answers whether the climber passed the rung, failed it, or is not decided yet.
//!
//! ## The scope seam
//!
//! Both cores observe the same split the coverage feature is built on, and the
//! callers must preserve it when they gather the inputs:
//!
//! - **A plan counts globally; a dispatch counts its own.** A plan cell's
//!   `counted`/`in_flight` counts every run of that cell whoever launched it, so a run
//!   someone else already produced is never re-requested. A ladder dispatch's rung slot
//!   counts only the jobs its own origin names, so running a configuration again
//!   measures it again.
//! - **Reviewing is per-account and gates nothing.** "Unreviewed" means no review row
//!   for the *requesting* account; plans and ladders only report it.
//! - **A gate reads the validators, never a reviewer.** A ladder's gate reads the
//!   lifted `run.validator_rating` — the validators' own rating with no review
//!   override folded in. Neither the run's stored `rating` column (which folds in
//!   every reviewer's overrides) nor any review may ever be fed to
//!   [`gate::evaluate`].

pub mod gate;
pub mod schedule;
