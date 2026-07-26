//! The live-particle budget an authored system must fit inside, and the projection
//! that decides whether it does.
//!
//! A particle system is **simulated live** by everything that plays it — the binary's
//! preview, the review UI, and a consuming game — so the count of particles alive at
//! once is a cost every consumer pays every frame, forever. A model authoring an
//! emitter has no feel for that cost: nothing in `--rate` or `--lifetime` suggests
//! that `--rate 20000 --lifetime 1600` means thirty thousand live particles, and the
//! binary's own preview never shows the difference because it draws at most
//! [`DRAW_CAP_3D`](crate::render) billboards a frame. The result is an effect that
//! looks fine in the run and stutters in the reviewer's browser.
//!
//! So the budget is enforced where it can still be acted on: at **authoring time**.
//! Every recorded operation is projected forward to the peak live-particle count the
//! system would settle at, and an operation that pushes it past
//! [`MAX_LIVE_PARTICLES`] is **rejected** with the projection and the emitters
//! responsible, rather than silently recorded. The [simulator](crate::sim) enforces
//! the same ceiling as a hard backstop for any system that reaches it another way.

use crate::sim::{MAX_GENERATION, child_burst_count, child_trail_rate};
use crate::system::{Emission, Emitter, SubTrigger, System};

/// The most particles an authored system may hold alive at once.
///
/// The figure is set by what a **reviewer's browser** can simulate smoothly, since the
/// review UI steps the whole system in JavaScript every frame: measured on the pure
/// simulator, ~12k live particles cost ~2.7 ms a frame and ~24k cost ~7 ms, so 10k
/// leaves an ordinary machine most of a 60 fps frame for the rest of the page. It
/// costs the effect nothing visible: the binary's own 3D preview draws at most 8,000
/// billboards a frame anyway, so a system authored to this budget is exactly as dense
/// as the densest preview a model can see.
pub const MAX_LIVE_PARTICLES: usize = 10_000;

/// One emitter's share of the projected peak.
#[derive(Debug, Clone, PartialEq)]
pub struct Contribution {
    /// The emitter's name.
    pub emitter: String,
    /// The particles it holds alive at once, at steady state.
    pub live: f64,
}

/// The projected peak live-particle count of a system, and where it comes from.
#[derive(Debug, Clone, PartialEq)]
pub struct Projection {
    /// The projected peak live-particle count of the whole system.
    pub total: f64,
    /// Each emitter's share, largest first (emitters holding nothing are omitted).
    pub contributions: Vec<Contribution>,
}

impl Projection {
    /// Whether the projection is over [`MAX_LIVE_PARTICLES`].
    pub fn exceeds_budget(&self) -> bool {
        self.total > MAX_LIVE_PARTICLES as f64
    }

    /// The rejection message an over-budget projection is reported with: what the
    /// system would cost, which emitters spend it, and what to turn down. It is read
    /// by a model mid-run, so it names the flags to change.
    pub fn over_budget_message(&self) -> String {
        let mut message = format!(
            "this system would hold about {} particles alive at once, over the \
             {MAX_LIVE_PARTICLES}-particle budget an effect has to fit in (every \
             consumer simulates the system live, every frame). A denser-looking effect \
             comes from particle size, opacity, and color, not from particle count.",
            self.total.round() as u64
        );
        if !self.contributions.is_empty() {
            message.push_str("\n\nWhat the system spends its particles on:");
            for c in &self.contributions {
                message.push_str(&format!(
                    "\n  {:<20} ~{} live",
                    c.emitter,
                    c.live.round() as u64
                ));
            }
        }
        message.push_str(
            "\n\nLower --rate (particles per second), --lifetime (how long each one \
             lives), or --burst, and the burst count of any sub-emitter child, until \
             the projected total fits. An emitter holds roughly `rate x lifetime` \
             particles alive at once: --rate 2000 --lifetime 1500 is ~3000 live.",
        );
        message
    }
}

/// Project the peak live-particle count `system` settles at.
///
/// The estimate mirrors the [simulator](crate::sim)'s own rules rather than sampling
/// it: at steady state a rate emitter holds `rate x lifetime` particles alive, and a
/// burst holds its count (re-fired every cycle of a looping timeline, so a lifetime
/// longer than the loop window overlaps into itself). Sub-emitter children are
/// projected from the traffic their parent hands them — one child burst per parent
/// death, or a trail along each live parent particle — generation by generation, to
/// the same [`MAX_GENERATION`] depth the simulator stops triggering at, so a
/// death-spawns-death chain terminates here exactly as it does there.
///
/// It is deliberately an **upper-bound** estimate: spreads count at their maximum, and
/// a sub-emitter's traffic is counted in full. Being generous to the effect and strict
/// about the ceiling is the right way round — the cost of over-estimating is an
/// emitter authored slightly smaller than it could be.
pub fn project(system: &System) -> Projection {
    let children = system.sub_emitter_children();
    let mut live = vec![0.0f64; system.emitters.len()];

    // Generation 0: the emitters the simulator runs on their own timeline. A
    // sub-emitter's child emits only when triggered, so it contributes nothing here.
    for (i, emitter) in system.emitters.iter().enumerate() {
        if children.contains(&emitter.name.as_str()) {
            continue;
        }
        live[i] = top_level_live(emitter, system);
    }

    // Each further generation is fed only by what the generation before it spawned.
    let mut frontier = live.clone();
    for _ in 0..MAX_GENERATION {
        let mut next = vec![0.0f64; system.emitters.len()];
        for sub in &system.sub_emitters {
            let (Some(parent), Some(child)) = (
                index_of(system, &sub.parent),
                index_of(system, &sub.emitter),
            ) else {
                continue;
            };
            if frontier[parent] <= 0.0 {
                continue;
            }
            let spawns_per_second = match sub.on {
                // Steady state: a parent dies as often as it is born, so its death
                // rate is its population over its lifetime.
                SubTrigger::Death => {
                    frontier[parent] / lifetime_seconds(&system.emitters[parent])
                        * child_burst_count(&system.emitters[child]) as f64
                }
                // A trail fires along every live parent particle's path.
                SubTrigger::Step => {
                    frontier[parent] * child_trail_rate(&system.emitters[child]) as f64
                }
            };
            next[child] += spawns_per_second * lifetime_seconds(&system.emitters[child]);
        }
        if next.iter().all(|&n| n <= 0.0) {
            break;
        }
        for (total, spawned) in live.iter_mut().zip(&next) {
            *total += spawned;
        }
        frontier = next;
    }

    let mut contributions: Vec<Contribution> = system
        .emitters
        .iter()
        .zip(&live)
        .filter(|&(_, &n)| n > 0.0)
        .map(|(emitter, &n)| Contribution {
            emitter: emitter.name.clone(),
            live: n,
        })
        .collect();
    contributions.sort_by(|a, b| b.live.total_cmp(&a.live));

    Projection {
        total: live.iter().sum(),
        contributions,
    }
}

/// The particles a top-level emitter holds alive at once, at steady state.
fn top_level_live(emitter: &Emitter, system: &System) -> f64 {
    let lifetime = lifetime_seconds(emitter);
    match emitter.emission {
        Emission::Rate { rate } => rate.max(0.0) as f64 * lifetime,
        Emission::Burst { count, .. } => {
            // A looping timeline re-fires the burst every cycle, so a particle that
            // outlives the loop window is still alive when the next burst lands.
            let cycles = if system.looping {
                let window = system.duration_ms.max(1) as f64 / 1000.0;
                (lifetime / window).ceil().max(1.0)
            } else {
                1.0
            };
            count as f64 * cycles
        }
    }
}

/// The longest a particle from `emitter` can live, in seconds (the spread counts at
/// its maximum, and a lifetime floors at the simulator's 1 ms minimum).
fn lifetime_seconds(emitter: &Emitter) -> f64 {
    let ms = (emitter.lifetime_ms.abs() + emitter.lifetime_spread.abs()).max(1.0);
    ms as f64 / 1000.0
}

/// The index of a declared emitter by name.
fn index_of(system: &System, name: &str) -> Option<usize> {
    system.emitters.iter().position(|e| e.name == name)
}

#[cfg(test)]
#[path = "budget.test.rs"]
mod tests;
