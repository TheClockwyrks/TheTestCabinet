//! `tcab analyze` — run the static code analyzer over a directory and print what it found.
//!
//! This is the analyzer with everything else taken away. The [same
//! analysis](test_cabinet_code_analysis::analyze) that runs as a post-run stage over a
//! finished run's produced tree also runs, unchanged, over any directory on disk — so the
//! figures a run reports can be reproduced, questioned and improved without a run, a
//! container, an API key or a backend. It is also the fastest way to answer "what does this
//! tree actually look like" about a tree nobody generated: this repository's own crates
//! included.
//!
//! # Why the output is shaped the way it is
//!
//! The analysis produces ninety-odd numbers, and a flat dump of ninety-odd numbers is a
//! wall nobody reads. So the report leads with the handful of figures that characterise a
//! tree in one line, then lays the rest out by family in the catalog's own order — which is
//! ordered by how much a reader wants the figure — and finishes with the things that are
//! *specific*: the functions that are hardest to read, the files that are largest, the
//! import cycles, the duplicated blocks. Those last sections are the point of the command
//! rather than a garnish; a mean cyclomatic complexity tells you a tree is fine, and a named
//! function with a cyclomatic complexity of 40 tells you where to go.
//!
//! Every numeric row is driven by [`CODE_METRICS`], never by a hand-written list here. A
//! metric added to the summary therefore appears in this report with its label, its unit and
//! its `approximate` flag already correct, and cannot drift out of step with the Code tab or
//! the field sidebar, which read the same table.

use std::path::Path;
use std::time::{Duration, Instant};

use anstyle::{AnsiColor, Color, Style};
use serde_json::Value;
use test_cabinet_code_analysis::walk::RootSeeding;
use test_cabinet_code_analysis::{AnalysisRequest, analyze};
use test_cabinet_core::{
    CODE_METRICS, CodeAnalysisDocument, CodeAuthoredBasis, CodeMetricUnit, CodeTreeBasis,
    CodeTruncationCap,
};

use crate::cli::AnalyzeArgs;

/// Analyse `args.path` and print the report.
///
/// Runs entirely on this machine and executes nothing in the tree it reads: no build, no
/// package manager, no script. The only subprocess is the read-only `git` the authored-set
/// ladder uses, and only when a repository is present.
pub async fn execute(args: AnalyzeArgs) -> anyhow::Result<()> {
    let root = Path::new(&args.path);
    if !root.is_dir() {
        anyhow::bail!(
            "{} is not a directory — `tcab analyze` takes the root of a source tree",
            args.path
        );
    }

    let started = Instant::now();
    let document = analyze(&AnalysisRequest {
        root,
        seed_commit: args.seed_commit.as_deref(),
        tree_basis: args.tree_basis.into(),
        // A checkout on disk carries no engine selection, so this command cannot know
        // whether a root-level `engine/` is an engine's seeded documentation or the
        // build's own code — and the default is to floor neither. Over-counting seeded
        // markdown makes a size figure a little large; the run path, which does know,
        // answers properly. With `--seed-commit`, the authored-set ladder removes seeded
        // material the model never touched regardless.
        root_seeding: RootSeeding::default(),
    });
    let elapsed = started.elapsed();

    if args.json {
        // The whole document, not the summary: `--json` exists so the per-file and
        // per-symbol tiers can be piped into something else, and the summary is embedded in
        // it anyway.
        println!("{}", serde_json::to_string_pretty(&document)?);
        return Ok(());
    }

    // `anstream` strips the escape sequences when stdout is not a terminal, so a piped or
    // redirected report is plain text without the command having to ask.
    anstream::print!(
        "{}",
        render_report(
            &args.path,
            &document,
            elapsed,
            args.top,
            args.seed_commit.as_deref(),
        )
    );
    Ok(())
}

/// How many members of one import cycle to name before summarising the rest.
///
/// A cycle of four is a design mistake worth reading in full; a cycle of forty is a fact
/// about the tree, and listing all forty buries the next section.
const CYCLE_MEMBERS_SHOWN: usize = 6;

/// Section headings, so the eye can find a family without reading it.
const HEADING: Style = Style::new().bold();

/// Column headers and caveats: present, but never competing with the figures.
const QUIET: Style = Style::new().fg_color(Some(Color::Ansi(AnsiColor::BrightBlack)));

/// Wrap `text` in `style`, which renders nothing at all when the style is empty and is
/// stripped by [`anstream`] when the destination is not a terminal.
fn styled(style: Style, text: &str) -> String {
    format!("{}{text}{}", style.render(), style.render_reset())
}

/// Render the whole report as one string.
///
/// A pure function of the document so the layout is testable without a filesystem, a
/// terminal or a clock — `elapsed` is passed in rather than measured here for exactly that
/// reason.
fn render_report(
    label: &str,
    document: &CodeAnalysisDocument,
    elapsed: Duration,
    top: usize,
    requested_seed_commit: Option<&str>,
) -> String {
    let mut out = String::new();
    let summary = &document.summary;

    out.push_str(&format!("\n{}\n", styled(HEADING, label)));
    out.push_str(&format!("  {}\n", headline(document)));
    out.push_str(&format!(
        "  {}\n",
        styled(QUIET, &provenance_line(document, elapsed))
    ));

    let (families, approximate_shown) = metric_sections(document);
    out.push_str(&families);

    out.push_str(&outlier_sections(document, top));

    let caveats = caveats(document, approximate_shown, requested_seed_commit);
    if !caveats.is_empty() {
        out.push_str(&format!("\n{}\n", styled(HEADING, "caveats")));
        for caveat in caveats {
            out.push_str(&format!("  {}\n", styled(QUIET, &caveat)));
        }
    }

    // A tree with nothing in it is far more often a mistaken path or an over-broad ignore
    // file than a genuinely empty directory, so say so instead of printing a page of zeros
    // and leaving the reader to infer it.
    if summary.size.files == 0 {
        out.push_str("\n  No files were analysed. Check the path, and whether an ignore file\n");
        out.push_str("  or the authored-set resolution excluded everything in it.\n");
    }

    out.push('\n');
    out
}

/// The one line that characterises the tree: the figures a reader wants before any others.
fn headline(document: &CodeAnalysisDocument) -> String {
    let summary = &document.summary;
    let mut parts = vec![
        plural(u64::from(summary.size.files), "file", "files"),
        format!("{} code lines", group(u64::from(summary.size.code_lines))),
        plural(
            u64::from(summary.complexity.functions),
            "function",
            "functions",
        ),
        plural(u64::from(summary.graph.nodes), "module", "modules"),
    ];
    if summary.graph.cycles > 0 {
        parts.push(plural(u64::from(summary.graph.cycles), "cycle", "cycles"));
    }
    parts.join(" · ")
}

/// The line that says what was measured, and under what basis — the provenance a figure is
/// meaningless without.
fn provenance_line(document: &CodeAnalysisDocument, elapsed: Duration) -> String {
    let summary = &document.summary;
    let languages = if summary.languages.is_empty() {
        "no parsed languages".to_string()
    } else {
        summary
            .languages
            .iter()
            .map(|language| language.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    };
    let authored = match summary.authored_basis {
        CodeAuthoredBasis::SeedCommit => "authored set: changed since the seed commit",
        CodeAuthoredBasis::RootCommit => "authored set: changed since the inferred seed root",
        CodeAuthoredBasis::AllFiles => "authored set: the whole tree",
    };
    let tree = match summary.tree_basis {
        CodeTreeBasis::PreValidation => "pre-validation",
        CodeTreeBasis::PostValidation => "post-validation",
    };
    format!("{languages} · {authored} · {tree} · {}", duration(elapsed))
}

/// One rendered numeric row.
struct MetricRow {
    label: String,
    value: String,
    approximate: bool,
}

/// Render every catalog family that has at least one resolvable metric, in catalog order.
///
/// Returns the rendered block and whether any row carried the approximate flag, so the
/// caveats can explain the marker only when one was actually printed.
fn metric_sections(document: &CodeAnalysisDocument) -> (String, bool) {
    let Ok(summary) = serde_json::to_value(&document.summary) else {
        return (String::new(), false);
    };

    // Group by family, preserving the catalog's order both of families and of the rows
    // within one. `CODE_METRICS` is ordered by how much a reader wants the figure, and
    // re-sorting here would throw that away.
    let mut families: Vec<(&'static str, Vec<MetricRow>)> = Vec::new();
    for metric in CODE_METRICS {
        // An absent value is the normal case for a language block a tree has none of:
        // `typescript` is null in a pure-Rust tree, and printing "TypeScript files: 0" for
        // it would be noise dressed as a measurement.
        let Some(value) = lookup(&summary, metric.path) else {
            continue;
        };
        let Some(rendered) = format_value(value, metric.unit) else {
            continue;
        };
        let row = MetricRow {
            label: metric.label.to_string(),
            value: rendered,
            approximate: metric.approximate,
        };
        match families.iter_mut().find(|(name, _)| *name == metric.family) {
            Some((_, rows)) => rows.push(row),
            None => families.push((metric.family, vec![row])),
        }
    }

    // One label width and one value width across every family, so the columns line up down
    // the whole report rather than jumping at each heading.
    let label_width = families
        .iter()
        .flat_map(|(_, rows)| rows.iter())
        .map(|row| row.label.chars().count())
        .max()
        .unwrap_or(0);
    let value_width = families
        .iter()
        .flat_map(|(_, rows)| rows.iter())
        .map(|row| row.value.chars().count())
        .max()
        .unwrap_or(0);

    let mut approximate_shown = false;
    let mut out = String::new();
    for (family, rows) in &families {
        out.push_str(&format!("\n{}\n", styled(HEADING, family_heading(family))));
        approximate_shown |= rows.iter().any(|row| row.approximate);
        out.push_str(&two_columns(rows, label_width, value_width));
    }
    (out, approximate_shown)
}

/// Lay a family's rows out in two columns, filling the left column first.
///
/// Down-then-across rather than across-then-down: the catalog is ordered by importance, and
/// filling left-first keeps the figures a reader wants most in one uninterrupted column.
fn two_columns(rows: &[MetricRow], label_width: usize, value_width: usize) -> String {
    let left_count = rows.len().div_ceil(2);
    let mut out = String::new();
    for index in 0..left_count {
        let left = cell(&rows[index], label_width, value_width);
        match rows.get(left_count + index) {
            Some(right) => out.push_str(&format!(
                "  {left}    {}\n",
                cell(right, label_width, value_width).trim_end()
            )),
            None => out.push_str(&format!("  {}\n", left.trim_end())),
        }
    }
    out
}

/// One `label ......... value ~` cell, padded to the shared column widths.
///
/// Leader dots rather than spaces: at these label widths an unbroken run of spaces makes the
/// eye lose the row, and the dots are what a printed table of figures has always done.
fn cell(row: &MetricRow, label_width: usize, value_width: usize) -> String {
    let label_len = row.label.chars().count();
    let leader = " ".to_string() + &".".repeat(label_width.saturating_sub(label_len) + 1) + " ";
    let value_pad = " ".repeat(value_width.saturating_sub(row.value.chars().count()));
    let marker = if row.approximate { " ~" } else { "  " };
    format!("{}{leader}{value_pad}{}{marker}", row.label, row.value)
}

/// The human heading for a catalog family.
///
/// Two kinds of family are renamed here: the ones whose own name does not read as a heading,
/// and the two whose name reads as a heading for the *wrong measurement*. Anything else —
/// including a family added to the catalog later — falls through to its own name rather than
/// being dropped, so a new family appears in this report before anyone remembers to name it
/// here.
///
/// The strings must stay identical to the console's `familyHeading`, modulo this function's
/// lowercase convention, so a reader who moves between `tcab analyze` and the run's Code tab
/// is reading the same report.
fn family_heading(family: &str) -> &str {
    match family {
        "size" => "size and shape",
        "graph" => "module graph",
        "api" => "public api",
        "typescript" => "typescript discipline",
        "rust" => "rust discipline",
        // These are static counts of test code the model *wrote* — files, functions, lines and
        // the ratio — and nothing here executes anything. Heading them "tests" put them beside
        // the executed test results the run record now carries and invited a reader to take
        // one for the other.
        "tests" => "test authorship",
        // `notes` is the walk's diagnostics *about the analysis* — what it truncated, what an
        // ignore file removed, how many files and bytes the floor skipped, what it could not
        // parse. Heading them "coverage" made them read as code coverage, which the static
        // analyzer does not measure and cannot, and collided with the console's own Coverage
        // area of plans and ladders.
        "notes" => "analysis notes",
        other => other,
    }
}

/// The specific sections: the named functions, files, cycles and duplicated blocks.
///
/// This is where a reader goes after the summary tells them something is off, so each row
/// carries a path and a line number that can be pasted into an editor.
fn outlier_sections(document: &CodeAnalysisDocument, top: usize) -> String {
    let mut out = String::new();

    let mut symbols: Vec<_> = document.symbols.iter().collect();
    // Sorted with a total tie-break so the report is a pure function of the document: two
    // functions with equal complexity would otherwise swap places between runs.
    symbols.sort_by(|a, b| {
        b.cyclomatic
            .cmp(&a.cyclomatic)
            .then(b.cognitive.cmp(&a.cognitive))
            .then(a.file.cmp(&b.file))
            .then(a.line.cmp(&b.line))
    });
    if !symbols.is_empty() {
        let shown = &symbols[..top.min(symbols.len())];
        // The name column is padded to the widest name actually shown, so the paths line up
        // into a column a reader can run their eye down rather than a ragged tail.
        let name_width = shown
            .iter()
            .map(|symbol| symbol.name.chars().count())
            .max()
            .unwrap_or(0);
        out.push_str(&format!(
            "\n{}\n",
            styled(HEADING, "most complex functions")
        ));
        out.push_str(&format!(
            "  {}\n",
            styled(
                QUIET,
                &format!(
                    "cyclo  cognitive  lines  {:<name_width$}  location",
                    "function"
                )
            )
        ));
        for symbol in shown {
            let path = document
                .files
                .get(symbol.file as usize)
                .map(|file| file.path.as_str())
                .unwrap_or("?");
            out.push_str(&format!(
                "  {:>5}  {:>9}  {:>5}  {:<name_width$}  {path}:{}\n",
                symbol.cyclomatic, symbol.cognitive, symbol.lines, symbol.name, symbol.line,
            ));
        }
    }

    let mut files: Vec<_> = document.files.iter().collect();
    files.sort_by(|a, b| b.code_lines.cmp(&a.code_lines).then(a.path.cmp(&b.path)));
    if !files.is_empty() {
        out.push_str(&format!("\n{}\n", styled(HEADING, "largest files")));
        out.push_str(&format!(
            "  {}\n",
            styled(QUIET, "lines  functions  fan-in  file")
        ));
        for file in files.iter().take(top) {
            out.push_str(&format!(
                "  {:>5}  {:>9}  {:>6}  {}\n",
                group(u64::from(file.code_lines)),
                file.functions,
                file.fan_in,
                file.path,
            ));
        }
    }

    if !document.cycles.is_empty() {
        out.push_str(&format!(
            "\n{}\n",
            styled(
                HEADING,
                &format!("import cycles ({})", document.cycles.len())
            )
        ));
        let mut cycles: Vec<_> = document.cycles.iter().collect();
        cycles.sort_by_key(|cycle| std::cmp::Reverse(cycle.len()));
        for cycle in cycles.iter().take(top) {
            let named: Vec<&str> = cycle
                .iter()
                .take(CYCLE_MEMBERS_SHOWN)
                .map(|index| {
                    document
                        .files
                        .get(*index as usize)
                        .map(|file| file.path.as_str())
                        .unwrap_or("?")
                })
                .collect();
            let more = cycle.len().saturating_sub(named.len());
            let tail = if more > 0 {
                format!(" → … ({more} more)")
            } else {
                String::new()
            };
            out.push_str(&format!(
                "  {:>3}  {}{tail}\n",
                cycle.len(),
                named.join(" → ")
            ));
        }
    }

    if !document.clones.is_empty() {
        out.push_str(&format!(
            "\n{}\n",
            styled(
                HEADING,
                &format!(
                    "largest duplicate blocks ({} groups)",
                    document.clones.len()
                )
            )
        ));
        let mut clones: Vec<_> = document.clones.iter().collect();
        clones.sort_by_key(|group| std::cmp::Reverse(group.lines));
        for group in clones.iter().take(top) {
            let sites: Vec<String> = group
                .instances
                .iter()
                .map(|instance| {
                    let path = document
                        .files
                        .get(instance.file as usize)
                        .map(|file| file.path.as_str())
                        .unwrap_or("?");
                    format!("{path}:{}", instance.line)
                })
                .collect();
            out.push_str(&format!(
                "  {:>4} lines × {}  {}\n",
                group.lines,
                group.instances.len(),
                sites.join(", ")
            ));
        }
    }

    out
}

/// Everything the reader has to know to not over-read the numbers above.
fn caveats(
    document: &CodeAnalysisDocument,
    approximate_shown: bool,
    requested_seed_commit: Option<&str>,
) -> Vec<String> {
    let notes = &document.summary.notes;
    let mut caveats = Vec::new();

    if approximate_shown {
        caveats.push(
            "~ approximate: dynamic imports, path aliases and bundler rewrites are not resolved"
                .to_string(),
        );
    }
    if let Some(cap) = notes.truncated_by {
        let reason = match cap {
            CodeTruncationCap::FileCount => {
                "the file-count cap fired; later files in sorted order were not visited"
            }
            CodeTruncationCap::ParseBytes => {
                "the parse-byte budget was exhausted; later files were counted for size only"
            }
            CodeTruncationCap::SymbolBudget => {
                "the symbol budget was exhausted; later files contributed no per-function complexity"
            }
        };
        caveats.push(format!("· truncated — {reason}"));
    }
    if notes.files_skipped > 0 {
        caveats.push(format!(
            "· {} skipped as binary, generated or unreadable ({})",
            plural(u64::from(notes.files_skipped), "file", "files"),
            bytes(notes.bytes_skipped),
        ));
    }
    if notes.files_unparsable > 0 {
        caveats.push(format!(
            "· {} did not parse and contributed size figures only",
            plural(u64::from(notes.files_unparsable), "file", "files"),
        ));
    }
    // The one caveat a reader cannot reconstruct from the report body. A refused file is
    // still in the file table with its size, so nothing above it looks wrong — but every
    // parsed-only figure was computed without it, and the tree's largest files are exactly
    // the ones the per-file caps turn away.
    if notes.files_refused > 0 {
        caveats.push(format!(
            "· {} too large or too deeply nested to parse; no complexity, API or \
             discipline figure includes them",
            plural(u64::from(notes.files_refused), "file", "files"),
        ));
    }
    if !notes.gitignore_applied {
        caveats.push(
            "· no ignore file was found, so build output and dependencies may be counted"
                .to_string(),
        );
    }
    // Passing a seed commit that the tree does not carry is the one degradation a caller can
    // actually fix, and it silently changes what "authored" means — so it is called out
    // rather than left to be inferred from the provenance line.
    if requested_seed_commit.is_some()
        && document.summary.authored_basis != CodeAuthoredBasis::SeedCommit
    {
        caveats.push(
            "· --seed-commit did not resolve in this tree; the whole tree was treated as authored"
                .to_string(),
        );
    }

    caveats
}

/// Resolve a dotted catalog path against the serialized summary.
///
/// A missing key and an explicit null are the same answer — the metric has no value in this
/// tree — because that is exactly what an absent language block looks like.
fn lookup<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = root;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    (!current.is_null()).then_some(current)
}

/// Format one metric's value for its unit.
///
/// Returns `None` for a value the unit cannot describe, which keeps a catalog/summary
/// mismatch out of the report rather than printing `null` at the reader.
fn format_value(value: &Value, unit: CodeMetricUnit) -> Option<String> {
    match unit {
        CodeMetricUnit::Boolean => value
            .as_bool()
            .map(|b| if b { "yes" } else { "no" }.to_string()),
        CodeMetricUnit::Bytes => value.as_u64().map(bytes),
        CodeMetricUnit::Ratio => value.as_f64().map(|f| format!("{:.1}%", f * 100.0)),
        CodeMetricUnit::PerKiloLine => value.as_f64().map(|f| format!("{f:.1}/kloc")),
        CodeMetricUnit::Score | CodeMetricUnit::Count | CodeMetricUnit::Lines => {
            value.as_f64().map(number)
        }
    }
}

/// Render a number: whole values grouped, fractional ones to one decimal.
///
/// A mean of `2.4` and a count of `66,258` are read very differently, and printing the count
/// as `66258.0` or the mean as `2` would each lose the distinction.
fn number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        let magnitude = group(value.abs() as u64);
        if value < 0.0 {
            format!("-{magnitude}")
        } else {
            magnitude
        }
    } else {
        format!("{value:.1}")
    }
}

/// Group an integer into thousands with commas.
fn group(value: u64) -> String {
    let digits = value.to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    grouped
}

/// Render a byte count in binary units.
fn bytes(value: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KiB", "MiB", "GiB"];
    let mut scaled = value as f64;
    let mut unit = 0;
    while scaled >= 1024.0 && unit < UNITS.len() - 1 {
        scaled /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{value} B")
    } else {
        format!("{scaled:.1} {}", UNITS[unit])
    }
}

/// Render a count with a noun that agrees with it.
fn plural(count: u64, singular: &str, plural: &str) -> String {
    let noun = if count == 1 { singular } else { plural };
    format!("{} {noun}", group(count))
}

/// Render the elapsed wall clock, in the unit that reads best at its magnitude.
///
/// Wall clock is reported but nothing in the analysis depends on it: every cap the analyzer
/// applies is derived from the tree's bytes, never from a clock, so this figure describes the
/// machine and never the result.
fn duration(elapsed: Duration) -> String {
    if elapsed.as_secs_f64() < 1.0 {
        format!("{} ms", elapsed.as_millis())
    } else {
        format!("{:.2} s", elapsed.as_secs_f64())
    }
}

#[cfg(test)]
#[path = "analyze.test.rs"]
mod tests;
