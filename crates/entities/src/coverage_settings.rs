//! The `coverage_settings` table: an account's coverage preferences.
//!
//! One row per account (the auth-service user id is the primary key), holding the
//! reviewer's default **buffer target** — how many runs they are willing to have
//! outstanding at once across a plan's or ladder's cells, counting both in-flight
//! jobs and completed runs they have not yet reviewed. Top-up emits whole cells
//! until that number is reached and then stops.
//!
//! It lives on the account rather than on each plan because it describes the
//! *person*: how much reviewing they can absorb in a sitting is the same whichever
//! plan they are feeding. Individual plans and ladders may still override it with
//! their own nullable `buffer_target`.
//!
//! A reviewer who has never changed the setting has **no row** — the backend falls
//! back to its compiled-in default rather than materializing one on read — so this
//! table records deliberate choices only. Reviewer tooling is console-only; it never
//! feeds the public snapshot.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "coverage_settings")]
pub struct Model {
    /// The owning account's id (from the auth service, via the verified bearer
    /// token). The primary key — one settings row per account.
    #[sea_orm(primary_key, auto_increment = false)]
    pub user_id: String,
    /// The account's default number of outstanding runs to keep buffered per plan or
    /// ladder. Not null: the row exists only because the reviewer chose a value.
    pub buffer_target: i32,
    /// RFC 3339 of when the settings were last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
