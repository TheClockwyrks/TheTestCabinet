// Midway — the money ledger + accounting (specs/economy.md; DESIGN.md §4). The park
// runs on one cash balance: income (admission, ride tickets, stall sales) lifts it,
// build costs / upkeep / wages / repairs draw it down, and it may go into the red. Once
// a day the accumulated upkeep + wages are charged and the day's income/expense rates are
// snapshotted for the HUD trend. Sustained debt past the grace period ends the park.
// Pure helpers over a Ledger; the Game (sim.ts) owns the Ledger and drives these.

import { TUNE } from "./constants";
import type { Ledger } from "./types";

export function makeLedger(cash: number): Ledger {
  return {
    cash,
    dayIncome: 0,
    dayExpense: 0,
    incomeRate: 0,
    expenseRate: 0,
    totalProfit: 0,
    belowFloorTimer: 0,
  };
}

// Book income (a sale/ticket/admission): cash + running-day income + lifetime profit.
export function earn(l: Ledger, amount: number): void {
  if (amount <= 0) return;
  l.cash += amount;
  l.dayIncome += amount;
  l.totalProfit += amount;
}

// Book an expense (build cost, upkeep, wages, a repair fee): cash + day expense + profit.
export function spend(l: Ledger, amount: number): void {
  if (amount <= 0) return;
  l.cash -= amount;
  l.dayExpense += amount;
  l.totalProfit -= amount;
}

// Called at each day rollover: charge the day's upkeep + wages, then snapshot the just-
// finished day's income/expense as the HUD's per-day trend and reset the accumulators.
export function chargeDaily(l: Ledger, upkeep: number, wages: number): void {
  spend(l, upkeep + wages);
  l.incomeRate = l.dayIncome;
  l.expenseRate = l.dayExpense;
  l.dayIncome = 0;
  l.dayExpense = 0;
}

// The last full day's income/expense/net rates (for the HUD trend arrow).
export function rates(l: Ledger): { income: number; expense: number; net: number } {
  return { income: l.incomeRate, expense: l.expenseRate, net: l.incomeRate - l.expenseRate };
}

// Advance the bankruptcy grace timer. While cash sits below the floor the timer grows;
// any recovery above the floor resets it. Returns true once the sustained-loss grace has
// been exceeded — the park is bankrupt (specs/economy.md).
export function bankruptcyStep(l: Ledger, dt: number): boolean {
  if (l.cash < TUNE.economy.bankruptcyFloor) {
    l.belowFloorTimer += dt;
  } else {
    l.belowFloorTimer = 0;
  }
  return l.belowFloorTimer > TUNE.economy.graceSeconds;
}
