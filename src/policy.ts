/**
 * THE SIGNALS PROBE402'S RECORD RAISES, AND THE CALLER'S POLICY OVER THEM.
 *
 * This tool reports facts. What a fact is worth is the caller's to say, so the shape here is: a
 * check produces zero or more NAMED SIGNALS, each a sentence with the date it stands on, and a
 * POLICY maps each name to `allow`, `warn` or `block`. `DEFAULT_POLICY` below is a table a developer
 * can read in one screen, and every row of it can be overridden with one line.
 *
 * The rulings are ranked `allow` < `warn` < `block` and the loudest signal wins.
 *
 * WHAT BLOCKS BY DEFAULT, AND WHY IT IS THOSE TWO.
 *   - `never-observed-delivering` — probe402 paid this route, money moved, and no attempt of its own
 *     came back with an answer the rubric could read. That is the strongest negative fact the record
 *     holds: it is about payments that were actually made, dated, with a receipt hash each.
 *   - `payment-address-differs` — no way to pay the 402 offers names the payment address probe402
 *     recorded. A payment to the wrong address is the loss that cannot be undone, so it stops here
 *     by default rather than being reported past.
 *
 * WHAT DOES NOT BLOCK, AND WHY.
 *   - probe402 having NEVER paid a route is probe402's own absence, not a fact about the endpoint.
 *     It is a warning so a developer sees it; it must not be the thing that stops somebody's payment.
 *   - probe402 being unreachable is our outage. It warns. A measurement tool that fails a payment
 *     because the measurement tool is down has decided something it has no standing to decide.
 *
 * The outcome words below are probe402's own published paid-rubric vocabulary
 * (https://probe402.com/rubric). A word outside all of them raises `paid-word-not-known` rather than
 * being read as delivery or as its absence: a word this version has never heard is a fact about this
 * version.
 */
import type { CheckResult, PaidAttempt, RouteResult } from "./check.ts";
import type { ChallengeComparison } from "./challenge.ts";

/** The one graded word that says a payment was answered. */
export const DELIVERED_OUTCOMES: readonly string[] = ["Settled and answered"];
/** The graded words that say money moved, whatever came back. */
export const MONEY_MOVED_OUTCOMES: readonly string[] = ["Settled and answered", "Settled, answer not usable", "Settled, no answer"];
/** The graded words that say nothing was paid. */
export const NOTHING_PAID_OUTCOMES: readonly string[] = ["Refused before settlement", "Not attempted"];
/** The graded word that says whether money moved is not known. */
export const UNCORROBORATED_OUTCOMES: readonly string[] = ["Settlement not corroborated"];

export type SignalName =
  | "never-observed-delivering"
  | "payment-address-differs"
  | "quote-differs"
  | "reading-past-cadence"
  | "newest-paid-attempt-refused"
  | "settlement-not-corroborated"
  | "paid-word-not-known"
  | "never-paid"
  | "not-quoting"
  | "no-reading"
  | "not-on-record"
  | "host-not-route"
  | "record-unavailable";

export type Ruling = "allow" | "warn" | "block";

/** A signal is a named fact with the date it stands on. */
export type Signal = { name: SignalName; because: string; as_of: string | null };

export type Policy = Readonly<Partial<Record<SignalName, Ruling>>>;

/** The defaults. Two block; the rest report. Override any row with one line. */
export const DEFAULT_POLICY: Readonly<Record<SignalName, Ruling>> = {
  "never-observed-delivering": "block",
  "payment-address-differs": "block",
  "quote-differs": "warn",
  "reading-past-cadence": "warn",
  "newest-paid-attempt-refused": "warn",
  "settlement-not-corroborated": "warn",
  "paid-word-not-known": "warn",
  "never-paid": "warn",
  "not-quoting": "warn",
  "no-reading": "warn",
  "not-on-record": "warn",
  "host-not-route": "warn",
  "record-unavailable": "warn",
};

const RANK: Readonly<Record<Ruling, number>> = { allow: 0, warn: 1, block: 2 };

export type Decision = {
  ruling: Ruling;
  /** Every signal the record raised, loudest first. */
  signals: Array<Signal & { ruling: Ruling }>;
  /** The signals that produced the ruling. */
  because: string;
  /** The grade address the reading is at, when there is a route to cite. */
  cite: string | null;
};

/** Every signal the record raises about this result, with the date each stands on. */
export function signalsOf(result: CheckResult, comparison: ChallengeComparison | null): Signal[] {
  if (result.kind === "host") {
    return [{ name: "host-not-route", because: `${result.host} is a host, not a route; ask again with the full URL of the route being paid`, as_of: null }];
  }
  if (result.kind === "not-on-record") {
    return [
      {
        name: "not-on-record",
        because: `probe402 holds no record of ${result.asked} (${result.reason ?? result.answer_kind}); that is a fact about probe402's coverage and says nothing about the endpoint`,
        as_of: null,
      },
    ];
  }
  return [...readingSignals(result), ...paidSignals(result), ...comparisonSignals(result, comparison)];
}

function readingSignals(result: RouteResult): Signal[] {
  const reading = result.reading;
  if (reading === null) {
    return [{ name: "no-reading", because: `probe402 holds ${result.endpoint.label} on its list and has no reading of it in the graded window`, as_of: result.window.to }];
  }
  const out: Signal[] = [];
  if (reading.past_cadence === true) {
    out.push({
      name: "reading-past-cadence",
      because: `the newest reading is ${reading.age} old, past the ${result.endpoint.cadence ?? "route's own"} cadence it is read on`,
      as_of: reading.observed_at,
    });
  }
  if (reading.outcome !== "Quoted") {
    out.push({ name: "not-quoting", because: `the newest reading was "${reading.outcome}", not a payment quote`, as_of: reading.observed_at });
  }
  return out;
}

function paidSignals(result: RouteResult): Signal[] {
  const attempts = result.paid_delivery.attempts;
  if (attempts.length === 0) {
    return [
      {
        name: "never-paid",
        because: result.paid_delivery.on_panel
          ? "this route is on probe402's paid panel and has no paid attempt on the record yet, so there is no paid-delivery reading"
          : "probe402 has not paid this route: it is not on the paid panel, so there is no paid-delivery reading",
        as_of: null,
      },
    ];
  }
  const newest = attempts[attempts.length - 1]!;
  const out: Signal[] = [];
  const moved = attempts.filter((a) => MONEY_MOVED_OUTCOMES.includes(a.outcome));
  const delivered = attempts.filter((a) => DELIVERED_OUTCOMES.includes(a.outcome));
  if (moved.length > 0 && delivered.length === 0) {
    out.push({
      name: "never-observed-delivering",
      because:
        `probe402 paid this route ${moved.length} time(s) and no attempt came back with an answer: ` +
        `${moved.map((a) => `${a.attempted_at} "${a.outcome}"`).join(", ")}`,
      as_of: newest.attempted_at,
    });
  }
  if (NOTHING_PAID_OUTCOMES.includes(newest.outcome)) {
    out.push({ name: "newest-paid-attempt-refused", because: `probe402's newest paid attempt was graded "${newest.outcome}", so nothing was paid`, as_of: newest.attempted_at });
  }
  if (delivered.length === 0 && moved.length === 0 && attempts.every((a) => UNCORROBORATED_OUTCOMES.includes(a.outcome))) {
    out.push({ name: "settlement-not-corroborated", because: `every paid attempt probe402 holds is graded "${newest.outcome}", so whether money moved is not known`, as_of: newest.attempted_at });
  }
  const unknown = attempts.filter((a) => !known(a));
  if (unknown.length > 0) {
    out.push({
      name: "paid-word-not-known",
      because: `probe402 graded ${unknown.length} paid attempt(s) with a word this version of probe402-check does not classify: ${unknown.map((a) => `"${a.outcome}"`).join(", ")}`,
      as_of: newest.attempted_at,
    });
  }
  return out;
}

function known(attempt: PaidAttempt): boolean {
  return (
    MONEY_MOVED_OUTCOMES.includes(attempt.outcome) ||
    NOTHING_PAID_OUTCOMES.includes(attempt.outcome) ||
    UNCORROBORATED_OUTCOMES.includes(attempt.outcome)
  );
}

function comparisonSignals(result: RouteResult, comparison: ChallengeComparison | null): Signal[] {
  if (comparison === null) return [];
  const asOf = result.reading?.observed_at ?? null;
  const out: Signal[] = [];
  if (comparison.pay_to_differs) {
    out.push({
      name: "payment-address-differs",
      because:
        `none of the ${comparison.offered} way(s) this 402 offers to pay names the payment address probe402 recorded ` +
        `(${result.quote?.pay_to ?? "none recorded"})`,
      as_of: asOf,
    });
  }
  const others = comparison.different.filter((field) => field !== "pay_to");
  if (others.length > 0) {
    out.push({ name: "quote-differs", because: `the 402 being answered differs from the quote probe402 recorded on ${others.join(", ")}`, as_of: asOf });
  }
  return out;
}

/** The signal raised when probe402 itself could not be asked. It is our outage, so it reports. */
export function recordUnavailable(message: string): Signal {
  return { name: "record-unavailable", because: `probe402 could not be asked: ${message}`, as_of: null };
}

/** Apply a policy to signals. The loudest ruling wins; with no signal the ruling is `allow`. */
export function rule(signals: readonly Signal[], policy: Policy = {}): Decision {
  const graded = signals
    .map((signal) => ({ ...signal, ruling: policy[signal.name] ?? DEFAULT_POLICY[signal.name] }))
    .sort((a, b) => RANK[b.ruling] - RANK[a.ruling]);
  const ruling: Ruling = graded[0]?.ruling ?? "allow";
  const deciding = graded.filter((signal) => signal.ruling === ruling);
  const because =
    ruling === "allow"
      ? "probe402's record raised nothing this policy acts on"
      : deciding.map((signal) => `${signal.name}: ${signal.because}`).join("; ");
  return { ruling, signals: graded, because, cite: null };
}

/** The whole decision for one check: the signals, the policy over them, and the address to cite. */
export function decide(result: CheckResult, comparison: ChallengeComparison | null, policy: Policy = {}): Decision {
  const decision = rule(signalsOf(result, comparison), policy);
  return { ...decision, cite: result.kind === "route" ? result.cite : null };
}
