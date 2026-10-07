//! The `coverage_settings` table: an account's coverage preferences.
//!
//! One row per account (the auth-service user id is the primary key), holding the
//! account's default **runs-in-flight limit**: how many of one plan's or one ladder
//! dispatch's own jobs may be queued, pending, dispatched, starting or running at once.
//! It keeps one plan or ladder from taking over the global queue. Completed runs never
//! count against it, reviewed or not. A launch pass emits whole cells until the limit is
//! reached and then stops — or, when the owner chose no bound at all, emits every missing
//! cell.
//!
//! Plans and ladders may override it with their own nullable `in_flight_limit`.
//!
//! An account that has never changed the setting has **no row** — the backend falls back
//! to its compiled-in default rather than materializing one on read — so this table
//! records deliberate choices only. It never feeds the public snapshot.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "coverage_settings")]
pub struct Model {
    /// The owning account's id (from the auth service, via the verified bearer
    /// token). The primary key — one settings row per account.
    #[sea_orm(primary_key, auto_increment = false)]
    pub user_id: String,
    /// The account's default runs-in-flight limit per plan or ladder dispatch. Not null:
    /// the row exists only because the owner chose a value.
    ///
    /// A non-negative value is the bound; a **negative** value records that the owner
    /// chose no bound (the backend's `InFlightLimit::Unbounded`), the one value a typed
    /// bound can never be. `coverage_plan` and `ladder` encode their overrides the same
    /// way.
    pub in_flight_limit: i32,
    /// RFC 3339 of when the settings were last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
