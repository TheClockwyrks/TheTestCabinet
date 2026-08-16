//! Adds the four **ladder** tables: `ladder`, `ladder_rung`, `ladder_climber`, and
//! `ladder_outcome`.
//!
//! A ladder is a sibling of the coverage plan, not a mode of it. A plan declares a
//! *set* of cells with no relationship between them and fills them in whatever
//! order the reviewer picked; a ladder declares an **ordered** list of rungs that a
//! harness+model combination climbs one at a time, and only carries on past a rung
//! when that rung's runs clear a quality **gate**. It is how a reviewer asks "how
//! far up my difficulty ordering does this model get before it falls over?" without
//! paying for the runs above the wall.
//!
//! The two entities are kept apart because almost nothing about them is shared
//! beyond membership resolution (both reference the same `coverage_group` rows with
//! `kind = "combo"`, so `resolve_members` serves both) and the top-up algorithm.
//! Folding gates, ordering, per-combination progress, and manual overrides into
//! `coverage_plan` would have made every plan carry columns that mean nothing to it.
//!
//! The split across four tables follows the existing rule of thumb in this schema:
//! list fields that are read and written whole stay JSON text (`combo_group_ids_json`,
//! `combos_json`, exactly as on `coverage_plan`), and anything that needs ordering or
//! per-row querying gets real rows. Rungs are ordered and individually reorderable;
//! outcomes are written one at a time as each gate resolves and are queried per
//! combination. Both are real rows.
//!
//! **Progress is never a global pointer.** There is deliberately no "current rung"
//! column on the ladder: progress lives entirely in `ladder_outcome`, one row per
//! (rung, combination), so a model added to a standing ladder next month starts at
//! rung 1 while the models already halfway up carry on undisturbed.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Ladder::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Ladder::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(Ladder::UserId).string().not_null())
                    .col(ColumnDef::new(Ladder::Name).string().not_null())
                    // `"rung"` (finish a rung across every climber before moving up)
                    // or `"combination"` (send one climber as far up as it gets
                    // before starting the next). Flips the loop nesting that emits
                    // runs; since `job.queue_seq` is monotonic and the dispatcher
                    // claims in ascending order, emission order is execution order.
                    .col(
                        ColumnDef::new(Ladder::OuterAxis)
                            .string()
                            .not_null()
                            .default("rung"),
                    )
                    // The default target runs for each rung × combination cell. A
                    // rung may override it (`ladder_rung.runs_override`) when one
                    // step needs more evidence than the rest.
                    .col(ColumnDef::new(Ladder::RunsPerCell).integer().not_null())
                    // The gate is one parameterised rule, not a menu of modes:
                    // advance when `count(my runs on this rung rated <floor> or
                    // better) >= <threshold>`. `gate_floor` is a `Rating` token.
                    .col(ColumnDef::new(Ladder::GateFloor).string().not_null())
                    // `"count"` (an absolute number of runs) or `"fraction"` (a share
                    // of the rung's completed runs, compared as
                    // `count >= fraction * completed`).
                    .col(
                        ColumnDef::new(Ladder::GateThresholdKind)
                            .string()
                            .not_null(),
                    )
                    // One column for both kinds because there is only ever one
                    // threshold: a whole number for `count`, a `0.0..=1.0` share for
                    // `fraction`. `double` holds the small integers of the `count`
                    // form exactly.
                    .col(
                        ColumnDef::new(Ladder::GateThresholdValue)
                            .double()
                            .not_null(),
                    )
                    // Off by default: a rung finishes all of its runs even once the
                    // outcome is already determined, because those extra runs are
                    // still evidence the reviewer asked for. Only when this is on
                    // does the ladder decide early and cancel the rung's remaining
                    // queued runs.
                    .col(
                        ColumnDef::new(Ladder::EarlyStop)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    // On by default: a run that never loaded is a `broken` result for
                    // gate purposes without anyone having to review it, so a wall of
                    // dead builds neither blocks the climb nor occupies buffer slots
                    // waiting for a review that would only ever say the same thing.
                    .col(
                        ColumnDef::new(Ladder::CountUnloadedAsBroken)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    // Suspends topping up while leaving the queue alone — the mildest
                    // of the three halting controls.
                    .col(
                        ColumnDef::new(Ladder::Paused)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    // Off by default: a ladder that enqueues work on every review
                    // submission must be opted into.
                    .col(
                        ColumnDef::new(Ladder::AutoTopUp)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    // Nullable: `NULL` means "use the account's `coverage_settings`
                    // default", which is a different statement from an explicit `0`.
                    .col(ColumnDef::new(Ladder::BufferTarget).integer())
                    // Nullable claim marker serializing top-up, exactly as on
                    // `coverage_plan`: holds the RFC 3339 claim time so a request
                    // that dies mid-top-up expires rather than wedging the ladder.
                    .col(ColumnDef::new(Ladder::ToppingUpAt).string())
                    // The climbers, referenced the same way a plan references its
                    // combinations: `coverage_group` ids (`kind = "combo"`) plus
                    // one-off combos, resolved and de-duped by `resolve_members`.
                    .col(ColumnDef::new(Ladder::ComboGroupIdsJson).text().not_null())
                    .col(ColumnDef::new(Ladder::CombosJson).text().not_null())
                    .col(ColumnDef::new(Ladder::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        // The account's ladder list is the only way ladders are enumerated.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_ladder_user")
                    .table(Ladder::Table)
                    .col(Ladder::UserId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(LadderRung::Table)
                    .if_not_exists()
                    // The stable opaque rung id, minted once when the rung is added.
                    // Deliberately *not* the position: rungs get reordered and
                    // re-pinned to newer case versions, and every recorded outcome
                    // references this id, so it must survive both.
                    .col(
                        ColumnDef::new(LadderRung::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(LadderRung::LadderId).string().not_null())
                    // The rung's place in the climb, low to high. Rewritten on a
                    // reorder while `id` stays put.
                    .col(ColumnDef::new(LadderRung::Position).integer().not_null())
                    // One test case pinned to an exact version and variant, the same
                    // triple a coverage plan's cases carry.
                    .col(ColumnDef::new(LadderRung::Slug).string().not_null())
                    .col(ColumnDef::new(LadderRung::Version).string().not_null())
                    .col(ColumnDef::new(LadderRung::Variant).string().not_null())
                    // Nullable: `NULL` inherits the ladder's `runs_per_cell`.
                    .col(ColumnDef::new(LadderRung::RunsOverride).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_ladder_rung_ladder")
                            .from(LadderRung::Table, LadderRung::LadderId)
                            .to(Ladder::Table, Ladder::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Rungs are always read as one ordered list per ladder. Not a *unique* index
        // on `(ladder_id, position)`: a reorder rewrites several positions in one
        // transaction and would transiently collide with itself under the immediate
        // uniqueness both SQLite and PostgreSQL apply by default.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_ladder_rung_ladder")
                    .table(LadderRung::Table)
                    .col(LadderRung::LadderId)
                    .col(LadderRung::Position)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(LadderClimber::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(LadderClimber::LadderId).string().not_null())
                    // The canonical `harness|model|provider` key of one resolved
                    // combination (empty trailing segment when the harness is not
                    // provider-routed). A key rather than three columns because the
                    // combination is only ever matched whole against the resolved
                    // member list.
                    .col(
                        ColumnDef::new(LadderClimber::CombinationKey)
                            .string()
                            .not_null(),
                    )
                    // Higher climbs first. Lets one model be pushed to the front
                    // without reordering the ladder itself, which would change what
                    // every other climber is being measured against.
                    .col(
                        ColumnDef::new(LadderClimber::Priority)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    // The reviewer's "watch this one" flag, surfaced by the dashboard
                    // and used to break priority ties.
                    .col(
                        ColumnDef::new(LadderClimber::Focused)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    // The manual downward override: stop this climber where it stands
                    // regardless of what its gates say. Reversible by clearing it.
                    .col(
                        ColumnDef::new(LadderClimber::Held)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(LadderClimber::UpdatedAt)
                            .string()
                            .not_null(),
                    )
                    // Composite key: one steering row per combination per ladder. A
                    // combination with no row is simply un-steered, so adding a model
                    // to a ladder writes nothing here.
                    .primary_key(
                        Index::create()
                            .col(LadderClimber::LadderId)
                            .col(LadderClimber::CombinationKey),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_ladder_climber_ladder")
                            .from(LadderClimber::Table, LadderClimber::LadderId)
                            .to(Ladder::Table, Ladder::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(LadderOutcome::Table)
                    .if_not_exists()
                    // Carried alongside `rung_id` (which is already globally unique)
                    // so the dashboard's "every outcome on this ladder" read is a
                    // prefix scan of this table's key instead of a join through
                    // `ladder_rung`.
                    .col(ColumnDef::new(LadderOutcome::LadderId).string().not_null())
                    .col(ColumnDef::new(LadderOutcome::RungId).string().not_null())
                    // The same canonical `harness|model|provider` key
                    // `ladder_climber` uses.
                    .col(
                        ColumnDef::new(LadderOutcome::CombinationKey)
                            .string()
                            .not_null(),
                    )
                    // The exact case version this verdict was decided against. Part
                    // of the key, not just a recorded field: bumping a rung to a
                    // newer case version must neither erase the verdict earned on the
                    // old one nor silently inherit it — different content, different
                    // judgement — and re-pinning back restores the original.
                    .col(
                        ColumnDef::new(LadderOutcome::DecidedVersion)
                            .string()
                            .not_null(),
                    )
                    // The automatically computed gate result: `"advanced"` or
                    // `"walled"`. No row at all means the gate has not resolved yet.
                    .col(ColumnDef::new(LadderOutcome::Outcome).string().not_null())
                    // The reviewer's manual override of that result, or `NULL` for
                    // none. Kept in its own column so recomputing the automatic
                    // outcome can never silently overwrite a human decision, and so
                    // clearing this column reverses the override exactly.
                    .col(ColumnDef::new(LadderOutcome::OverrideOutcome).string())
                    // RFC 3339 of when the override was applied, `NULL` when there is
                    // none.
                    .col(ColumnDef::new(LadderOutcome::OverrideAt).string())
                    // RFC 3339 of when the automatic outcome was last computed.
                    .col(ColumnDef::new(LadderOutcome::DecidedAt).string().not_null())
                    .primary_key(
                        Index::create()
                            .col(LadderOutcome::LadderId)
                            .col(LadderOutcome::RungId)
                            .col(LadderOutcome::CombinationKey)
                            .col(LadderOutcome::DecidedVersion),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_ladder_outcome_ladder")
                            .from(LadderOutcome::Table, LadderOutcome::LadderId)
                            .to(Ladder::Table, Ladder::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    // Deleting a rung retires its verdicts with it; they describe a
                    // step of the climb that no longer exists.
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_ladder_outcome_rung")
                            .from(LadderOutcome::Table, LadderOutcome::RungId)
                            .to(LadderRung::Table, LadderRung::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // One climber's whole progress — every rung it has resolved — is the read the
        // top-up and the status computation both make, and the primary key's
        // `ladder_id`-first ordering does not serve it.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_ladder_outcome_combination")
                    .table(LadderOutcome::Table)
                    .col(LadderOutcome::LadderId)
                    .col(LadderOutcome::CombinationKey)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Dropped children-first: the outcome rows reference both of the others.
        manager
            .drop_table(Table::drop().table(LadderOutcome::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(LadderClimber::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(LadderRung::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Ladder::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Ladder {
    Table,
    Id,
    UserId,
    Name,
    OuterAxis,
    RunsPerCell,
    GateFloor,
    GateThresholdKind,
    GateThresholdValue,
    EarlyStop,
    CountUnloadedAsBroken,
    Paused,
    AutoTopUp,
    BufferTarget,
    ToppingUpAt,
    ComboGroupIdsJson,
    CombosJson,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum LadderRung {
    Table,
    Id,
    LadderId,
    Position,
    Slug,
    Version,
    Variant,
    RunsOverride,
}

#[derive(DeriveIden)]
enum LadderClimber {
    Table,
    LadderId,
    CombinationKey,
    Priority,
    Focused,
    Held,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum LadderOutcome {
    Table,
    LadderId,
    RungId,
    CombinationKey,
    DecidedVersion,
    Outcome,
    OverrideOutcome,
    OverrideAt,
    DecidedAt,
}
