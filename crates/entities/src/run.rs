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
    /// The slug of the engine the produced build was written against, lifted from
    /// `record.subject.engine_slug` (`none` = the build supplied its own runtime).
    /// The engine is a run dimension — the same case version can run on several
    /// engines and results are only comparable within one — so the case Runs tab
    /// filters on this column in SQL.
    ///
    /// `NULL` only for a row written before the column existed whose record no
    /// longer deserializes: every readable record carries a slug (pre-engine-era
    /// records deserialize to the default `none`), and the startup backfill
    /// (`Db::backfill_engine_slug`) lifts it into the column.
    #[sea_orm(nullable)]
    pub engine_slug: Option<String>,
    pub harness_slug: String,
    pub harness_version: Option<String>,
    pub model_id: String,
    /// The name of the gg **configuration** the run was launched from, lifted from
    /// `record.subject.gg_capability_set.preset`. A gg run has no single harness
    /// model — `model_id` is only its representative primary-slot binding — so the
    /// console's run log identifies a gg row by its configuration, and the listing
    /// searches and orders that cell by this column rather than by `model_id`.
    ///
    /// Display text and a slicing key, not identity: the run's cell is keyed on
    /// [`gg_config_id`](Self::gg_config_id), so renaming a configuration re-points
    /// nothing.
    ///
    /// `NULL` for every non-gg run (the lift is gated on the harness) and for a gg
    /// run assembled by hand rather than from a named configuration; both fall back
    /// to `model_id` wherever this column is consulted.
    #[sea_orm(nullable)]
    pub gg_preset: Option<String>,
    /// The **id** of the gg configuration the run was launched from, lifted from
    /// `record.subject.gg_capability_set.preset_id`.
    ///
    /// It is the first half of a gg run's cell identity, and the id rather than the
    /// [name](Self::gg_preset) because a name is display text: an operator rewrites one
    /// freely and two of an account's configurations may carry the same one, so a cell
    /// keyed on the name would empty itself on a rename and merge two configurations that
    /// happen to agree. The ladder's climber key is the same id, so a rung's verdicts and
    /// the runs counted under them describe one configuration.
    ///
    /// `NULL` for every non-gg run (the lift is gated on the harness), for a gg run
    /// assembled by hand rather than from a saved configuration, and for a gg row written
    /// before the column existed whose configuration the startup backfill
    /// (`Db::backfill_gg_config_id`) could not resolve — all of which read as the empty
    /// segment, the harness form of the cell key.
    #[sea_orm(column_type = "Text", nullable)]
    pub gg_config_id: Option<String>,
    /// The models the run's gg capability set binds, sorted, de-duplicated, and
    /// comma-joined, lifted from `record.subject.gg_capability_set` beside
    /// [`gg_preset`](Self::gg_preset).
    ///
    /// It is the second half of a gg run's cell identity. The
    /// [configuration](Self::gg_config_id) says *what* was run and this says *on what*:
    /// one configuration can bind a different model to every agent, so two runs of one
    /// configuration that differ only on a subagent's model are two arms, and a cell
    /// reading `model_id` alone — the representative primary-slot binding — would merge
    /// them. It names which
    /// agent runs which model rather than the bare set, because two arms that swap
    /// two models between two agents bind the same set. Stored as one sorted, joined
    /// string so the coverage counts can group on it in SQL and so the order the set
    /// happened to list its agents in cannot split a cell.
    ///
    /// `NULL` for every non-gg run, which reads as the empty segment — the harness
    /// form of the cell key. A gg row written before the column existed is filled by
    /// its own startup backfill (`Db::backfill_gg_models`) and **not** by the one that
    /// maintains the other lifted sort columns: that pass only claims rows whose
    /// `test_type` is still empty, which no gg row has ever been.
    #[sea_orm(column_type = "Text", nullable)]
    pub gg_models: Option<String>,
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
    /// The run's **functional** rating as its lowercase wire token
    /// (`flawless`/`great`/`passable`/`scuffed`/`broken`). On a legacy run the worst
    /// rating any reviewer gave any domain, or `NULL` while it carries no reviews,
    /// maintained on review-add; on a [validator-rated](Self::validator_rated) run
    /// the validator-decided rating, written at push time and untouched by reviews.
    #[sea_orm(nullable)]
    pub rating: Option<String>,
    /// The run's aggregate **aesthetic** rating — the worst aesthetic rating any
    /// reviewer gave any domain — as its lowercase wire token
    /// (`legendary`/`amazing`/`good`/`okay`/`slop`), or `NULL` when no review has
    /// rated the aesthetic channel: a validator-rated run nobody has reviewed yet,
    /// and every legacy run (whose reviews carry no aesthetic ratings). Maintained
    /// on review-add exactly like `rating`.
    #[sea_orm(nullable)]
    pub aesthetic: Option<String>,
    /// Whether the run's case version is **validator-rated** (on the engine
    /// manifest format and not a game jam), so `rating` is the validator-decided
    /// functional rating written at push time rather than an aggregate of the
    /// reviews, the score stands without a review, and the publish gate admits the
    /// run with zero reviews. `false` for every legacy run. Written on every push
    /// from the case version the backend resolves; never changed by a review.
    pub validator_rated: bool,
    /// How many reviews the run carries. Maintained alongside `rating` on
    /// review-add; `0` for a pushed-but-unreviewed run.
    pub review_count: i64,
    /// The generation of the static code analyzer that produced this run's
    /// `record.codeAnalysis` figures, or `NULL` for a run that carries none.
    ///
    /// Lifted so a corpus spanning two analyzer generations is *sliceable* rather than
    /// silently incomparable: a metric whose definition (or cap) changed produces a step
    /// change in the aggregate that reads exactly like a model getting worse, and this is
    /// the column that makes the mix visible without deserializing every record.
    ///
    /// `NULL` means **never analysed** — there is no backfill of the analysis itself,
    /// because a historical run's tree can only be re-read post-validation and those are
    /// not the same figures. Rows written before the column existed but carrying a
    /// summary are filled by the startup backfill.
    ///
    /// Nothing reads this to score or rank a run.
    #[sea_orm(nullable)]
    pub code_analyzer_version: Option<i32>,
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
    /// Whether [`record_json`](Self::record_json) deserialized into the current
    /// `RunRecord` when this row's readability was last decided.
    ///
    /// Every run listing filters on this column, so a listing's `COUNT(*)` and the
    /// page it serves run one predicate and the total a listing reports equals the
    /// number of rows it returns. A row marked unreadable is served only by the
    /// unreadable listing, which reports the error its record produces now, and is
    /// deleted through the ordinary delete path (which reads the row, not the
    /// record).
    pub record_readable: bool,
    /// The `RUN_RECORD_FORMAT` generation this row's
    /// [`record_readable`](Self::record_readable) was decided under. A row whose
    /// stamp differs from the running build's is re-decided by the startup sweep
    /// (`Db::revalidate_run_records`), which is the whole corpus exactly once after
    /// a record-contract change and no rows in the steady state.
    pub record_format: i32,
    /// The run's recorded normalized event stream as a JSON array, or `NULL`.
    #[sea_orm(column_type = "Text", nullable)]
    pub events_json: Option<String>,
    /// RFC 3339 of the last write that changed anything observable about this row
    /// — the **mutation timestamp**, distinct from `finished_at` (when the run
    /// stopped executing) and `published_at` (when it went public).
    ///
    /// **Every mutator of a `run` row must stamp this**, and the only supported way
    /// to do so is the backend store's `touch_run` helper (the one writer of this
    /// column, beside [`Db`](../../test_cabinet_backend/db/struct.Db.html)'s
    /// mutators in `crates/backend/src/db.rs`): a mutation that forgets it silently
    /// reinstates a stale document in the in-memory index that reconciles against
    /// this column, and nothing fails loudly when it does. Do not set the field on
    /// an `ActiveModel` by hand.
    ///
    /// The readability marker ([`record_readable`](Self::record_readable) and
    /// [`record_format`](Self::record_format)) is the one exception: it records
    /// whether this build can decode the row, which is a fact about the build rather
    /// than a change to the run. Stamping it would make the document index reload,
    /// every cycle, a run whose document can never be built.
    ///
    /// Compared for **inequality**, never ordered: the RFC 3339 rendering drops the
    /// fractional part when it is exactly zero, so string ordering is unreliable
    /// between two stamps less than a second apart.
    pub updated_at: String,
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
