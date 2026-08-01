//! The rollup: everything the passes found, folded into the
//! [`CodeAnalysisDocument`] contract.
//!
//! Two tiers come out of one fold. The **summary** is bounded — roughly ninety-five scalars
//! that ride on the run record and are deserialized on every run listing. The **document**
//! is unbounded: every file, every symbol, every edge, every cycle, every clone group,
//! served per run as its own artifact.
//!
//! # Where the approximation is
//!
//! Cross-file reference counting happens here, and it is the reason
//! [`api.unreferencedExports`](test_cabinet_core::CodeApiSummary::unreferenced_exports) and
//! its ratio carry the `approximate` flag in the metric catalog. An export is "referenced"
//! when some *other* authored file mentions an identifier of the same name, or re-exports
//! the module wholesale through a barrel. That is honest in aggregate and unreliable per
//! symbol: it cannot tell one module's `render` from another's, and it is blind to a
//! reference that exists only in a dynamic import, a computed member access, or a bundler
//! config.

use std::collections::{BTreeMap, BTreeSet};

use test_cabinet_core::{
    CODE_ANALYZER_VERSION, CodeAnalysisDocument, CodeAnalysisNotes, CodeAnalysisSummary,
    CodeApiSummary, CodeAuthoredBasis, CodeCloneGroup, CodeCloneInstance, CodeComplexitySummary,
    CodeDuplicationSummary, CodeFileEntry, CodeGraphSummary, CodeImportEdge, CodeLanguage,
    CodeRustSummary, CodeSizeSummary, CodeSymbolEntry, CodeTestSummary, CodeTreeBasis,
    CodeTruncationCap, CodeTypeScriptSummary,
};

use crate::AnalyzedFile;
use crate::clones::Clones;
use crate::graph::ModuleGraph;

/// Everything the rollup folds.
pub(crate) struct Rollup<'a> {
    pub files: &'a [AnalyzedFile],
    pub graph: &'a ModuleGraph,
    pub clones: &'a Clones,
    pub authored_basis: CodeAuthoredBasis,
    pub tree_basis: CodeTreeBasis,
    pub gitignore_applied: bool,
    pub skipped_files: u32,
    pub skipped_bytes: u64,
    pub truncated_by: Option<CodeTruncationCap>,
}

/// Fold one analysis into the contract.
pub(crate) fn build(input: Rollup<'_>) -> CodeAnalysisDocument {
    let references = ReferenceIndex::new(input.files, input.graph);
    let summary = CodeAnalysisSummary {
        analyzer_version: CODE_ANALYZER_VERSION,
        authored_basis: input.authored_basis,
        tree_basis: input.tree_basis,
        languages: languages(input.files),
        size: size(input.files),
        complexity: complexity(input.files),
        graph: graph_summary(input.graph),
        api: api(input.files, &references),
        typescript: typescript(input.files),
        rust: rust(input.files),
        tests: tests(input.files),
        duplication: duplication(input.files, input.clones),
        notes: CodeAnalysisNotes {
            truncated: input.truncated_by.is_some(),
            truncated_by: input.truncated_by,
            gitignore_applied: input.gitignore_applied,
            files_skipped: input.skipped_files,
            bytes_skipped: input.skipped_bytes,
            files_unparsable: input
                .files
                .iter()
                .filter(|file| file.size_only_reason == Some("parse-failed"))
                .count() as u32,
        },
    };

    CodeAnalysisDocument {
        analyzer_version: CODE_ANALYZER_VERSION,
        summary,
        files: file_entries(input.files, input.graph),
        symbols: symbols(input.files, &references),
        imports: input
            .graph
            .edges
            .iter()
            .map(|(from, to)| CodeImportEdge {
                from: *from as u32,
                to: *to as u32,
            })
            .collect(),
        cycles: input
            .graph
            .cycles
            .iter()
            .map(|cycle| cycle.iter().map(|node| *node as u32).collect())
            .collect(),
        clones: input
            .clones
            .groups
            .iter()
            .map(|group| CodeCloneGroup {
                lines: group.lines,
                instances: group
                    .instances
                    .iter()
                    .map(|instance| CodeCloneInstance {
                        file: instance.file as u32,
                        line: instance.line,
                    })
                    .collect(),
            })
            .collect(),
    }
}

/// The languages a front end actually parsed, sorted and deduplicated.
fn languages(files: &[AnalyzedFile]) -> Vec<CodeLanguage> {
    let found: BTreeSet<CodeLanguage> = files.iter().filter_map(AnalyzedFile::language).collect();
    found.into_iter().collect()
}

fn size(files: &[AnalyzedFile]) -> CodeSizeSummary {
    let mut summary = CodeSizeSummary {
        files: files.len() as u32,
        ..CodeSizeSummary::default()
    };
    let mut per_file: Vec<u32> = Vec::with_capacity(files.len());
    let mut directories: BTreeSet<&str> = BTreeSet::new();
    let mut root_code_lines: u32 = 0;

    for file in files {
        summary.bytes += file.bytes;
        summary.code_lines += file.lines.code;
        summary.comment_lines += file.lines.comment;
        summary.blank_lines += file.lines.blank;
        if file.facts.is_some() {
            summary.parsed_files += 1;
        } else {
            summary.size_only_files += 1;
        }
        per_file.push(file.lines.code);
        let directory = file
            .path
            .rsplit_once('/')
            .map(|(head, _)| head)
            .unwrap_or("");
        directories.insert(directory);
        if directory.is_empty() {
            root_code_lines += file.lines.code;
        }
        summary.max_directory_depth = summary
            .max_directory_depth
            .max(file.path.matches('/').count() as u32);
        if file.lines.code > 500 {
            summary.files_over500_lines += 1;
        }
        if file.lines.code > 1000 {
            summary.files_over1000_lines += 1;
        }
    }

    summary.directories = directories.len() as u32;
    summary.mean_files_per_directory = ratio(files.len() as f64, directories.len() as f64);
    summary.root_share = ratio(root_code_lines as f64, summary.code_lines as f64);
    summary.gini_code_lines = gini(&per_file);
    per_file.sort_unstable();
    summary.max_file_code_lines = per_file.last().copied().unwrap_or(0);
    summary.median_file_code_lines = percentile(&per_file, 0.5);
    summary.p90_file_code_lines = percentile(&per_file, 0.9);
    summary
}

fn complexity(files: &[AnalyzedFile]) -> CodeComplexitySummary {
    let mut summary = CodeComplexitySummary::default();
    let mut lines_total: u64 = 0;
    let mut nesting_total: u64 = 0;
    let mut parameters_total: u64 = 0;
    let mut exits_total: u64 = 0;

    for function in files
        .iter()
        .filter_map(|file| file.facts.as_ref())
        .flat_map(|facts| &facts.functions)
    {
        summary.functions += 1;
        summary.total_cyclomatic += function.cyclomatic;
        summary.total_cognitive += function.cognitive;
        summary.max_cyclomatic = summary.max_cyclomatic.max(function.cyclomatic);
        summary.max_cognitive = summary.max_cognitive.max(function.cognitive);
        summary.max_nesting = summary.max_nesting.max(function.max_nesting);
        summary.max_parameters = summary.max_parameters.max(function.parameters);
        summary.max_exits = summary.max_exits.max(function.exits);
        summary.max_function_lines = summary.max_function_lines.max(function.lines);
        if function.cyclomatic > 10 {
            summary.functions_over10_cyclomatic += 1;
        }
        if function.cyclomatic > 20 {
            summary.functions_over20_cyclomatic += 1;
        }
        lines_total += u64::from(function.lines);
        nesting_total += u64::from(function.max_nesting);
        parameters_total += u64::from(function.parameters);
        exits_total += u64::from(function.exits);
    }

    let count = f64::from(summary.functions);
    summary.mean_cyclomatic = ratio(f64::from(summary.total_cyclomatic), count);
    summary.mean_cognitive = ratio(f64::from(summary.total_cognitive), count);
    summary.mean_max_nesting = ratio(nesting_total as f64, count);
    summary.mean_parameters = ratio(parameters_total as f64, count);
    summary.mean_exits = ratio(exits_total as f64, count);
    summary.mean_function_lines = ratio(lines_total as f64, count);
    summary
}

fn graph_summary(graph: &ModuleGraph) -> CodeGraphSummary {
    let nodes = graph.nodes.len() as u32;
    let mut summary = CodeGraphSummary {
        nodes,
        edges: graph.edges.len() as u32,
        cycles: graph.cycles.len() as u32,
        largest_cycle: graph
            .cycles
            .iter()
            .map(|cycle| cycle.len() as u32)
            .max()
            .unwrap_or(0),
        files_in_cycles: graph.cycles.iter().flatten().collect::<BTreeSet<_>>().len() as u32,
        orphans: graph.orphans.len() as u32,
        max_depth: graph.max_depth,
        external_packages: graph.external_packages.len() as u32,
        entry_points: graph.entry_points.len() as u32,
        ..CodeGraphSummary::default()
    };

    let mut instability_total = 0.0;
    let mut coupled = 0u32;
    for node in &graph.nodes {
        let out = graph.fan_out.get(node).copied().unwrap_or(0);
        let inbound = graph.fan_in.get(node).copied().unwrap_or(0);
        summary.max_fan_out = summary.max_fan_out.max(out);
        summary.max_fan_in = summary.max_fan_in.max(inbound);
        if out + inbound > 0 {
            instability_total += f64::from(out) / f64::from(out + inbound);
            coupled += 1;
        }
    }
    // Averaged over the *coupled* files only: an isolated module has no instability, and
    // counting it as zero would say "perfectly stable", which is the opposite of true.
    summary.mean_instability = ratio(instability_total, f64::from(coupled));
    summary.mean_fan_out = ratio(f64::from(summary.edges), f64::from(nodes));
    summary.mean_fan_in = summary.mean_fan_out;
    summary
}

fn api(files: &[AnalyzedFile], references: &ReferenceIndex) -> CodeApiSummary {
    let mut exports = 0u32;
    let mut unreferenced = 0u32;
    for (position, file) in files.iter().enumerate() {
        let Some(facts) = file.facts.as_ref() else {
            continue;
        };
        for name in &facts.exports {
            exports += 1;
            if references.count(position, name) == 0 {
                unreferenced += 1;
            }
        }
    }
    let modules = files.iter().filter(|file| file.facts.is_some()).count() as f64;
    CodeApiSummary {
        exports,
        mean_exports_per_module: ratio(f64::from(exports), modules),
        unreferenced_exports: unreferenced,
        unreferenced_export_ratio: ratio(f64::from(unreferenced), f64::from(exports)),
    }
}

fn typescript(files: &[AnalyzedFile]) -> Option<CodeTypeScriptSummary> {
    let parsed: Vec<&AnalyzedFile> = files
        .iter()
        .filter(|file| file.language() == Some(CodeLanguage::TypeScript))
        .collect();
    if parsed.is_empty() {
        return None;
    }
    let mut summary = CodeTypeScriptSummary {
        files: parsed.len() as u32,
        ..CodeTypeScriptSummary::default()
    };
    let (mut parameters, mut annotated_parameters) = (0u32, 0u32);
    let (mut functions, mut annotated_returns) = (0u32, 0u32);
    let (mut exported_functions, mut exported_annotated) = (0u32, 0u32);
    for file in &parsed {
        let facts = file.facts.as_ref().expect("a parsed file has facts");
        summary.code_lines += file.lines.code;
        summary.any_occurrences += facts.typescript.any_occurrences;
        summary.unknown_occurrences += facts.typescript.unknown_occurrences;
        summary.suppression_comments += facts.typescript.suppression_comments;
        summary.non_null_assertions += facts.typescript.non_null_assertions;
        summary.assertion_casts += facts.typescript.assertion_casts;
        summary.type_declarations += facts.typescript.type_declarations;
        parameters += facts.typescript.parameters;
        annotated_parameters += facts.typescript.annotated_parameters;
        functions += facts.typescript.functions;
        annotated_returns += facts.typescript.annotated_returns;
        exported_functions += facts.typescript.exported_functions;
        exported_annotated += facts.typescript.exported_annotated_returns;
    }
    summary.any_density = per_kloc(summary.any_occurrences, summary.code_lines);
    summary.type_declarations_per_kloc = per_kloc(summary.type_declarations, summary.code_lines);
    summary.annotated_parameter_ratio =
        ratio(f64::from(annotated_parameters), f64::from(parameters));
    summary.annotated_return_ratio = ratio(f64::from(annotated_returns), f64::from(functions));
    summary.exported_annotated_ratio =
        ratio(f64::from(exported_annotated), f64::from(exported_functions));
    Some(summary)
}

fn rust(files: &[AnalyzedFile]) -> Option<CodeRustSummary> {
    let parsed: Vec<&AnalyzedFile> = files
        .iter()
        .filter(|file| file.language() == Some(CodeLanguage::Rust))
        .collect();
    if parsed.is_empty() {
        return None;
    }
    let mut summary = CodeRustSummary {
        files: parsed.len() as u32,
        ..CodeRustSummary::default()
    };
    let mut items = 0u32;
    for file in &parsed {
        let facts = file.facts.as_ref().expect("a parsed file has facts");
        summary.code_lines += file.lines.code;
        summary.unsafe_items += facts.rust.unsafe_items;
        summary.unwrap_calls += facts.rust.unwrap_calls;
        summary.expect_calls += facts.rust.expect_calls;
        summary.panic_sites += facts.rust.panic_sites;
        summary.todo_macros += facts.rust.todo_macros;
        summary.suppressed_lints += facts.rust.suppressed_lints;
        summary.clone_calls += facts.rust.clone_calls;
        summary.public_items += facts.rust.public_items;
        summary.traits += facts.rust.traits;
        summary.generic_items += facts.rust.generic_items;
        items += facts.rust.items;
    }
    summary.unwrap_density = per_kloc(
        summary.unwrap_calls + summary.expect_calls,
        summary.code_lines,
    );
    summary.clone_density = per_kloc(summary.clone_calls, summary.code_lines);
    summary.public_ratio = ratio(f64::from(summary.public_items), f64::from(items));
    Some(summary)
}

fn tests(files: &[AnalyzedFile]) -> CodeTestSummary {
    let mut summary = CodeTestSummary::default();
    let mut all_code_lines = 0u32;
    for file in files {
        all_code_lines += file.lines.code;
        let Some(facts) = file.facts.as_ref() else {
            continue;
        };
        summary.test_functions += facts.test_functions;
        if facts.is_test {
            summary.test_files += 1;
            summary.test_code_lines += file.lines.code;
        }
    }
    summary.test_line_ratio = ratio(
        f64::from(summary.test_code_lines),
        f64::from(all_code_lines),
    );
    summary
}

fn duplication(files: &[AnalyzedFile], clones: &Clones) -> CodeDuplicationSummary {
    let parsed_code_lines: u32 = files
        .iter()
        .filter(|file| file.facts.is_some())
        .map(|file| file.lines.code)
        .sum();
    CodeDuplicationSummary {
        cloned_lines: clones.cloned_lines,
        cloned_line_ratio: ratio(f64::from(clones.cloned_lines), f64::from(parsed_code_lines)),
        clone_groups: clones.groups.len() as u32,
        largest_clone_lines: clones.largest_clone_lines,
    }
}

fn file_entries(files: &[AnalyzedFile], graph: &ModuleGraph) -> Vec<CodeFileEntry> {
    files
        .iter()
        .enumerate()
        .map(|(position, file)| {
            let facts = file.facts.as_ref();
            CodeFileEntry {
                path: file.path.clone(),
                language: file.language(),
                bytes: file.bytes,
                code_lines: file.lines.code,
                comment_lines: file.lines.comment,
                blank_lines: file.lines.blank,
                functions: facts.map(|facts| facts.functions.len() as u32).unwrap_or(0),
                cyclomatic: facts
                    .map(|facts| facts.functions.iter().map(|f| f.cyclomatic).sum())
                    .unwrap_or(0),
                cognitive: facts
                    .map(|facts| facts.functions.iter().map(|f| f.cognitive).sum())
                    .unwrap_or(0),
                fan_out: graph.fan_out.get(&position).copied().unwrap_or(0),
                fan_in: graph.fan_in.get(&position).copied().unwrap_or(0),
                is_test: facts.is_some_and(|facts| facts.is_test),
                size_only_reason: file.size_only_reason.map(str::to_string),
            }
        })
        .collect()
}

fn symbols(files: &[AnalyzedFile], references: &ReferenceIndex) -> Vec<CodeSymbolEntry> {
    let mut symbols = Vec::new();
    for (position, file) in files.iter().enumerate() {
        let Some(facts) = file.facts.as_ref() else {
            continue;
        };
        for function in &facts.functions {
            symbols.push(CodeSymbolEntry {
                file: position as u32,
                name: function.name.clone(),
                line: function.line,
                lines: function.lines,
                cyclomatic: function.cyclomatic,
                cognitive: function.cognitive,
                max_nesting: function.max_nesting,
                parameters: function.parameters,
                exits: function.exits,
                exported: function.exported,
                // A non-exported function's references are not attributed across files at
                // all, and reporting a within-file count under the same column would be a
                // different measurement wearing the same name.
                references: function
                    .exported
                    .then(|| references.count(position, &function.name)),
            });
        }
    }
    symbols
}

/// Which files mention which identifiers, and which modules are re-exported wholesale.
///
/// The approximation, in one place. See the module docs for what it can and cannot see.
struct ReferenceIndex {
    mentions: BTreeMap<String, BTreeSet<usize>>,
    reexported_by: BTreeMap<usize, u32>,
    fan_in: BTreeMap<usize, u32>,
}

impl ReferenceIndex {
    fn new(files: &[AnalyzedFile], graph: &ModuleGraph) -> Self {
        let mut mentions: BTreeMap<String, BTreeSet<usize>> = BTreeMap::new();
        for (position, file) in files.iter().enumerate() {
            let Some(facts) = file.facts.as_ref() else {
                continue;
            };
            for name in facts.identifiers.keys() {
                mentions.entry(name.clone()).or_default().insert(position);
            }
        }
        let mut reexported_by: BTreeMap<usize, u32> = BTreeMap::new();
        for (_, to) in &graph.reexport_edges {
            *reexported_by.entry(*to).or_insert(0) += 1;
        }
        Self {
            mentions,
            reexported_by,
            fan_in: graph.fan_in.clone(),
        }
    }

    /// How many other authored files appear to reference `name`, exported from `owner`.
    fn count(&self, owner: usize, name: &str) -> u32 {
        // A default export has no name to match on, so the only signal available is that
        // something imported the module at all.
        if name == "default" {
            return self.fan_in.get(&owner).copied().unwrap_or(0);
        }
        let by_name = self
            .mentions
            .get(name)
            .map(|files| files.iter().filter(|file| **file != owner).count() as u32)
            .unwrap_or(0);
        // A barrel references every name it re-exports without writing any of them down.
        by_name + self.reexported_by.get(&owner).copied().unwrap_or(0)
    }
}

/// `numerator / denominator`, or zero when there is nothing to divide.
///
/// Every mean and ratio in the summary goes through this so an empty tree produces zeros
/// rather than `NaN`, which does not survive JSON at all.
fn ratio(numerator: f64, denominator: f64) -> f64 {
    if denominator == 0.0 {
        0.0
    } else {
        numerator / denominator
    }
}

/// A count per thousand code lines.
fn per_kloc(count: u32, code_lines: u32) -> f64 {
    ratio(f64::from(count) * 1000.0, f64::from(code_lines))
}

/// The Gini coefficient of `values`.
///
/// Zero means every file is the same size; approaching one means a single file holds
/// everything. One number that answers "did the model split the work?", and it costs a sort.
///
/// Computed from the sorted form of the standard mean-absolute-difference definition, which
/// is `O(n log n)` rather than the `O(n²)` double sum.
fn gini(values: &[u32]) -> f64 {
    let mut sorted: Vec<f64> = values.iter().map(|value| f64::from(*value)).collect();
    sorted.sort_by(|left, right| left.total_cmp(right));
    let count = sorted.len() as f64;
    let total: f64 = sorted.iter().sum();
    if count == 0.0 || total == 0.0 {
        return 0.0;
    }
    let weighted: f64 = sorted
        .iter()
        .enumerate()
        .map(|(index, value)| (index as f64 + 1.0) * value)
        .sum();
    ((2.0 * weighted) / (count * total)) - ((count + 1.0) / count)
}

/// The nearest-rank percentile of an ascending-sorted slice.
fn percentile(sorted: &[u32], fraction: f64) -> u32 {
    if sorted.is_empty() {
        return 0;
    }
    let rank = (fraction * sorted.len() as f64).ceil().max(1.0) as usize;
    sorted[rank.min(sorted.len()) - 1]
}

#[cfg(test)]
#[path = "rollup.test.rs"]
mod tests;
