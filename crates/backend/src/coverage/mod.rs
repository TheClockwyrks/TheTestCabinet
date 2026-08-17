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
//! - [`schedule`] — the shared top-up algorithm. Given the cells of a plan (or the
//!   rung of a ladder) in the order the owner chose, it answers which cells to
//!   launch and how many runs each, keeping a bounded number of runs outstanding
//!   rather than firing every missing run at once.
//! - [`gate`] — the single parameterised rung gate. Given the requesting account's
//!   own ratings for a rung's completed runs, it answers whether the climber
//!   advances, is walled, or is not decided yet.
//!
//! ## The scope seam
//!
//! Both cores observe the same split the coverage feature is built on, and the
//! callers must preserve it when they gather the inputs:
//!
//! - **Counts are global.** A cell's `completed`/`in_flight` counts every run of
//!   that cell whoever launched it, so a run someone else already produced is
//!   never re-requested.
//! - **Judgement is per-account.** "Unreviewed" means no review row for the
//!   *requesting* account, and a gate reads only that account's ratings. A run's
//!   stored `rating` column is the worst domain across **all** reviewers and must
//!   never be fed to [`gate::evaluate`]; pass the worst domain within the
//!   requester's own single review instead (see
//!   [`aggregate_rating`](test_cabinet_core::review::aggregate_rating)).

pub mod gate;
pub mod schedule;
