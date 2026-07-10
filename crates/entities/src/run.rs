//! The `run` table: one published run, holding the verbatim `RunRecord` JSON
//! blob plus the columns lifted out of it for ordering, pagination, and
//! filtering. The review and links live in sibling tables keyed by `id`.

use sea_orm::entity::prelude::*;

// `Eq` is intentionally omitted: `run_time_seconds`/`cost_comparable` are `f64`,
// which is `PartialEq` but not `Eq`.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "run")]
pub struct Model {
    /// The run id (`RunRecord.id`); the primary key, assigned by the caller.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub started_at: String,
    pub finished_at: String,
    /// RFC 3339 of the first publish, or `NULL` while the run is still only
    /// pushed (unpublished). The newest-first sort/pagination key for the public
    /// listing, which only ever sees published runs.
    #[sea_orm(nullable)]
    pub published_at: Option<String>,
    pub test_case_slug: String,
    pub test_case_version: String,
    pub variant: String,
    pub harness_slug: String,
    pub harness_version: Option<String>,
    pub model_id: String,
    /// The run's test type, lifted from `record.subject.test_type` as its
    /// kebab-case wire token (`end-to-end`, `asset-generation`, …). Lets the
    /// console listing filter/sort by category without parsing the record blob.
    /// Carries a `""` default for rows written before this column existed; the
    /// startup backfill fills them in.
    pub test_type: String,
    pub run_state: String,
    /// The run's end-to-end wall-clock time in seconds, lifted from
    /// `record.metrics.run_time_seconds` so the console can sort by run time.
    pub run_time_seconds: f64,
    /// The run's total token count across every class, lifted from
    /// `record.metrics.tokens` (the same sum the UI's `totalTokens` shows). An
    /// unreported class folds into the class it is accounted under; a run with no
    /// tokens recorded stores `0`.
    pub total_tokens: i64,
    /// The run's comparable cost (USD) from `record.metrics.cost.comparable`, or
    /// `NULL` when the cost is unknown (its per-token prices could not be
    /// resolved). Distinct from a genuine `0.0` (a free run).
    #[sea_orm(nullable)]
    pub cost_comparable: Option<f64>,
    /// The run's aggregate rating — the worst rating any reviewer gave any domain
    /// — as its lowercase wire token (`flawless`/`great`/`scuffed`/`broken`), or
    /// `NULL` when the run carries no reviews yet. Maintained on review-add.
    #[sea_orm(nullable)]
    pub rating: Option<String>,
    /// How many reviews the run carries. Maintained alongside `rating` on
    /// review-add; `0` for a pushed-but-unreviewed run.
    pub review_count: i64,
    /// Whether the produced build loaded (lifted from the validation summary).
    pub loaded: bool,
    /// Whether the run has been published. A pushed run starts unpublished
    /// (private, playable for reviewers) and is flipped to published — gated on
    /// having at least one review — by an explicit publish. Only published runs
    /// enter the public snapshot.
    pub published: bool,
    /// The full `RunRecord` serialized verbatim (links populated).
    #[sea_orm(column_type = "Text")]
    pub record_json: String,
    /// The run's recorded normalized event stream as a JSON array, or `NULL`.
    #[sea_orm(column_type = "Text", nullable)]
    pub events_json: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    /// A run has many reviews — different accounts may each review it once.
    #[sea_orm(has_many = "super::review::Entity")]
    Review,
    #[sea_orm(has_one = "super::run_link::Entity")]
    RunLink,
}

impl Related<super::review::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Review.def()
    }
}

impl Related<super::run_link::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RunLink.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
