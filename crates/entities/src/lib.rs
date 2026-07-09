//! SeaORM entity models for the backend's system of record.
//!
//! These mirror the four tables created by [`test-cabinet-migration`] and are the
//! typed surface `crates/backend/src/db.rs` reads and writes. They are
//! driver-agnostic: the same models serve the SQLite (local/dev/tests) and
//! PostgreSQL (deployment) backends SeaORM connects to.
//!
//! Shapes follow `design/v0.2.0-contracts.md` §2: a `run` carries the verbatim
//! `RunRecord` JSON plus lifted columns for ordering/pagination, with the review
//! and links in sibling tables keyed by the run id, and a single-row
//! `snapshot_state` holding the snapshot coalescing flags.

pub mod job;
pub mod model;
pub mod model_alias;
pub mod model_price;
pub mod publish_job;
pub mod review;
pub mod run;
pub mod run_link;
pub mod snapshot_state;
pub mod tournament;
