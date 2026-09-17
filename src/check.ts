/**
 * THE PRE-PAYMENT CHECK.
 *
 * An agent holding a payment request for an x402 or MPP endpoint asks probe402's public record
 * about that endpoint before it signs: is the route quoting right now, quoting what, has probe402
 * itself paid it and what came back, how old the newest reading is, and the address to cite. The
 * answer is a reading with its date on it, never a statement about what the endpoint is; the
 * decision stays with the agent's own policy.
 *
 * One request per check, to the free grade. A URL naming a host rather than a route answers the
 * host's routes, each with its own grade address.
 */
import { ENDPOINT_ID, fetchPublic, gradeByIdUrl, gradeByUrlUrl, type Fetch } from "./public-surfaces.ts";

/** The grade address an answer names for a route; the record's own `grade_url` when it carries one. */
function citeOf(answer: Record<string, unknown>, id: string): string {
  const own = typeof answer["grade_url"] === "string" ? (answer["grade_url"] as string) : null;
  return own ?? gradeByIdUrl(id);
}

/** The payment request the agent is holding, as far as it wants it compared against the record. */
export type HeldQuote = {
  pay_to?: string;
  amount_atomic?: string;
  network?: string;
  asset?: string;
  scheme?: string;
};

export type CheckInput = {
  /** The resource URL the agent is about to pay, a host URL, or a probe402 endpoint id. */
  url: string;
  held_quote?: HeldQuote;
};

export type CheckOptions = {
  fetch?: Fetch;
};

export type RecordedQuote = {
  scheme: string | null;
  network: string | null;
  amount_atomic: string | null;
  asset: string | null;
  pay_to: string | null;
  max_timeout_s: number | null;
};

export type PaidAttempt = { attempted_at: string; outcome: string };

export type PaidDelivery = {
  on_panel: boolean;
  last_paid_at: string | null;
  attempts: PaidAttempt[];
  newest: PaidAttempt | null;
  record_source: string | null;
  record_says: string | null;
  basis: string | null;
};

export type HeldQuoteComparison = {
  compared: string[];
  same: string[];
  different: string[];
  pay_to_differs: boolean;
};

export type RouteResult = {
  kind: "route";
  asked: string;
  endpoint: {
    id: string;
    label: string;
    resource: string | null;
    method: string | null;
    rail: string | null;
    operator: string | null;
    cadence: string | null;
    cadence_statement: string | null;
  };
  reading: {
    outcome: string;
    observed_at: string;
    age_s: number | null;
    age: string;
    past_cadence: boolean | null;
    http_status: number | null;
    latency_ms: number | null;
    capture_sha256: string | null;
    age_statement: string | null;
  } | null;
  quote: RecordedQuote | null;
  window: {
    days: number | null;
    from: string | null;
    to: string | null;
    rows: number | null;
    observations: number | null;
    absences_filed: number | null;
    quote_changes: number | null;
    by_outcome: Record<string, number>;
  };
  paid_delivery: PaidDelivery;
  held_quote: HeldQuoteComparison | null;
  cite: string;
  method: string | null;
  non_affiliation: string | null;
  verdict: string;
};

export type HostRoute = {
  endpoint_id: string;
  method: string | null;
  path: string | null;
  probe_url: string | null;
  cadence: string | null;
  grade_url: string;
  on_panel: boolean;
  last_paid_at: string | null;
  attempts: number;
};

export type HostResult = {
  kind: "host";
  asked: string;
  host: string;
  routes: HostRoute[];
  counts: { routes: number; on_panel: number; paid: number };
  statement: string | null;
  verdict: string;
};

export type NotOnRecordResult = {
  kind: "not-on-record";
  asked: string;
  answer_kind: string;
  reason: string | null;
  statement: string | null;
  verdict: string;
};

export type CheckResult = RouteResult | HostResult | NotOnRecordResult;

/** Ask probe402 about `input.url` and read the answer. One request. */
export async function checkBeforePaying(input: CheckInput, options: CheckOptions = {}): Promise<CheckResult> {
  const asked = input.url.trim();
  const target = ENDPOINT_ID.test(asked) ? gradeByIdUrl(asked) : gradeByUrlUrl(asked);
  const response = await fetchPublic(target, options.fetch);
  if (!response.ok) throw new Error(`probe402 answered HTTP ${response.status} for ${target}`);
  const answer = (await response.json()) as Record<string, unknown>;
  return readAnswer(asked, answer, input.held_quote ?? null);
}

/** Read a free-grade answer into a result. Pure, so a recorded answer can drive it. */
export function readAnswer(asked: string, answer: Record<string, unknown>, heldQuote: HeldQuote | null): CheckResult {
  const kind = str(answer["kind"]) ?? "unknown";
  if (kind === "covered") return readRoute(asked, answer, heldQuote);
  if (kind === "host") return readHost(asked, answer);
  const statement = str(answer["statement"]);
  const reason = str(answer["reason"]);
  return {
    kind: "not-on-record",
    asked,
    answer_kind: kind,
    reason,
    statement,
    verdict:
      `probe402 holds no record of ${asked} (${reason ?? kind}). That is a fact about probe402's coverage and says nothing ` +
      `about the endpoint. There is no reading to cite.`,
  };
}

function readRoute(asked: string, answer: Record<string, unknown>, heldQuote: HeldQuote | null): RouteResult {
  const endpoint = obj(answer["endpoint"]);
  const current = obj(answer["current"]);
  const readingAge = obj(answer["reading_age"]);
  const standing = obj(answer["record_standing"]);
  const counts = obj(answer["counts"]);
  const window = obj(answer["window"]);
  const tier = obj(answer["tier"]);
  const paid = obj(answer["paid_verification"]);
  const id = str(endpoint["endpoint_id"]) ?? asked;
  const label = str(endpoint["label"]) ?? id;
  const cite = citeOf(answer, id);

  const quoteRecord = obj(current["quote"]);
  const quote: RecordedQuote | null =
    Object.keys(quoteRecord).length === 0
      ? null
      : {
          scheme: str(quoteRecord["scheme"]),
          network: str(quoteRecord["network_caip2"]) ?? str(quoteRecord["network_native"]),
          amount_atomic: str(quoteRecord["amount_atomic"]),
          asset: str(quoteRecord["asset"]),
          pay_to: str(quoteRecord["pay_to"]),
          max_timeout_s: num(quoteRecord["max_timeout_s"]),
        };

  const observedAt = str(current["observed_at"]);
  const outcome = str(current["outcome"]);
  const ageS = num(readingAge["age_s"]);
  const reading: RouteResult["reading"] =
    observedAt === null || outcome === null
      ? null
      : {
          outcome,
          observed_at: observedAt,
          age_s: ageS,
          age: ageWords(ageS),
          past_cadence: bool(readingAge["past_cadence"]),
          http_status: num(current["http_status"]),
          latency_ms: num(current["latency_total_ms"]),
          capture_sha256: str(current["capture_sha256"]),
          age_statement: str(readingAge["statement"]),
        };

  const attemptsRaw = Array.isArray(paid["attempts"]) ? (paid["attempts"] as unknown[]) : [];
  const attempts: PaidAttempt[] = attemptsRaw
    .map((a) => obj(a))
    .map((a) => ({ attempted_at: str(a["attempted_at"]) ?? "", outcome: str(a["outcome"]) ?? "" }))
    .filter((a) => a.attempted_at !== "" && a.outcome !== "");
  const recordSource = obj(paid["record_source"]);
  const paidDelivery: PaidDelivery = {
    on_panel: bool(paid["selected"]) ?? false,
    last_paid_at: str(paid["last_paid_at"]),
    attempts,
    newest: attempts.length === 0 ? null : attempts[attempts.length - 1]!,
    record_source: str(recordSource["source"]),
    record_says: str(recordSource["says"]),
    basis: str(paid["basis"]),
  };

  const byOutcomeRaw = obj(counts["by_outcome"]);
  const by_outcome: Record<string, number> = {};
  for (const [k, v] of Object.entries(byOutcomeRaw)) if (typeof v === "number") by_outcome[k] = v;

  const result: RouteResult = {
    kind: "route",
    asked,
    endpoint: {
      id,
      label,
      resource: str(endpoint["resource"]),
      method: str(endpoint["method"]),
      rail: str(endpoint["rail"]),
      operator: str(endpoint["operator"]),
      cadence: str(endpoint["cadence"]),
      cadence_statement: str(endpoint["cadence_statement"]),
    },
    reading,
    quote,
    window: {
      days: num(tier["days"]),
      from: str(window["from"]),
      to: str(window["to"]),
      rows: num(standing["rows_in_window"]),
      observations: num(counts["observations"]),
      absences_filed: num(standing["filed_absences"]),
      quote_changes: num(counts["quote_changes"]),
      by_outcome,
    },
    paid_delivery: paidDelivery,
    held_quote: heldQuote === null ? null : compareHeldQuote(heldQuote, quote),
    cite,
    method: str(answer["method_url"]),
    non_affiliation: str(answer["non_affiliation"]),
    verdict: "",
  };
  result.verdict = routeVerdict(result);
  return result;
}

function readHost(asked: string, answer: Record<string, unknown>): HostResult {
  const host = str(answer["host"]) ?? str(obj(answer["query"])["host"]) ?? asked;
  const routesRaw = Array.isArray(answer["routes"]) ? (answer["routes"] as unknown[]) : [];
  const routes: HostRoute[] = routesRaw.map((r) => {
    const row = obj(r);
    const paid = obj(row["paid"]);
    const id = str(row["endpoint_id"]) ?? "";
    const probeUrl = str(row["probe_url"]);
    return {
      endpoint_id: id,
      method: str(row["method"]),
      path: pathOf(probeUrl),
      probe_url: probeUrl,
      cadence: str(row["probe_policy"]),
      grade_url: str(row["grade_url"]) ?? (ENDPOINT_ID.test(id) ? gradeByIdUrl(id) : ""),
      on_panel: bool(paid["selected"]) ?? false,
      last_paid_at: str(paid["last_paid_at"]),
      attempts: num(paid["attempts"]) ?? 0,
    };
  });
  const onPanel = routes.filter((r) => r.on_panel).length;
  const paidCount = routes.filter((r) => r.last_paid_at !== null).length;
  return {
    kind: "host",
    asked,
    host,
    routes,
    counts: { routes: routes.length, on_panel: onPanel, paid: paidCount },
    statement: str(answer["statement"]),
    verdict:
      `${host} has ${routes.length} route(s) on probe402's list; ${onPanel} of them on the paid panel and ${paidCount} paid by ` +
      `probe402. This address names a host, not a route, so nothing here grades anything: ask again with the full URL of ` +
      `the route you are about to pay, and cite that route's own grade.`,
  };
}

/** The one-line reading an agent can put in its own reasoning. */
export function routeVerdict(r: RouteResult): string {
  const parts: string[] = [];
  if (r.reading === null) {
    parts.push(`${r.endpoint.label}: probe402 holds it on its list and has no reading of it in the ${r.window.days ?? "current"}-day window.`);
  } else {
    const when = `as of ${r.reading.observed_at} (${r.reading.age} ago${cadenceClause(r)})`;
    parts.push(`${r.endpoint.label} ${outcomeClause(r.reading.outcome, r.quote)} ${when}.`);
  }
  if (r.window.observations !== null && r.window.quote_changes !== null && r.window.observations > 0) {
    const changes = r.window.quote_changes === 0 ? "did not change" : `changed ${r.window.quote_changes} time(s)`;
    parts.push(`The quote ${changes} across ${r.window.observations} reading(s) in ${r.window.days ?? "the"} days.`);
  }
  if (r.window.absences_filed !== null && r.window.absences_filed > 0) {
    parts.push(`probe402 filed ${r.window.absences_filed} absence(s) of its own in that window (times it did not look).`);
  }
  if (r.paid_delivery.newest !== null) {
    parts.push(`probe402 paid this route on ${r.paid_delivery.newest.attempted_at} and graded the result "${r.paid_delivery.newest.outcome}".`);
  } else if (r.paid_delivery.on_panel) {
    parts.push("This route is on probe402's paid panel and has no paid attempt on the record yet.");
  } else {
    parts.push("probe402 has not paid this route: it is not on the paid panel, so there is no paid-delivery reading.");
  }
  if (r.held_quote !== null) {
    if (r.held_quote.different.length === 0) {
      parts.push(`The payment request you hold matches the recorded quote on ${r.held_quote.same.join(", ")}.`);
    } else {
      parts.push(
        `The payment request you hold DIFFERS from the recorded quote on ${r.held_quote.different.join(", ")}` +
          (r.held_quote.pay_to_differs ? " (the payment address is not the recorded one)." : "."),
      );
    }
  }
  parts.push(`Cite ${r.cite}.`);
  return parts.join(" ");
}

function outcomeClause(outcome: string, quote: RecordedQuote | null): string {
  switch (outcome) {
    case "Quoted":
      return quote === null
        ? "was quoting"
        : `was quoting ${quote.amount_atomic ?? "?"} atomic units of ${quote.asset ?? "?"} on ${quote.network ?? "?"} to ${quote.pay_to ?? "?"}`;
    case "Answered, no quote":
      return "answered without a payment quote";
    case "Blocked or challenged":
      return "refused probe402 as a client (defended, which is not the same as down)";
    case "Unreachable":
      return "gave probe402 no usable response on that probe (one probe's result, not a finding that it is down)";
    case "Not probed":
      return "was not looked at by probe402 on that cycle (its absence, recorded as its own)";
    default:
      return `read "${outcome}"`;
  }
}

function cadenceClause(r: RouteResult): string {
  if (r.reading === null || r.reading.past_cadence === null) return "";
  const cadence = r.endpoint.cadence ?? "its";
  return r.reading.past_cadence ? `, PAST the ${cadence} cadence it is read on` : `, inside its ${cadence} cadence`;
}

export function compareHeldQuote(held: HeldQuote, recorded: RecordedQuote | null): HeldQuoteComparison {
  const compared: string[] = [];
  const same: string[] = [];
  const different: string[] = [];
  const fields: Array<[keyof HeldQuote, string | null, (v: string) => string]> = [
    ["pay_to", recorded?.pay_to ?? null, lower],
    ["amount_atomic", recorded?.amount_atomic ?? null, atomic],
    ["network", recorded?.network ?? null, lower],
    ["asset", recorded?.asset ?? null, lower],
    ["scheme", recorded?.scheme ?? null, lower],
  ];
  for (const [field, recordedValue, normalize] of fields) {
    const heldValue = held[field];
    if (heldValue === undefined) continue;
    compared.push(field);
    if (recordedValue !== null && normalize(heldValue) === normalize(recordedValue)) same.push(field);
    else different.push(field);
  }
  return { compared, same, different, pay_to_differs: different.includes("pay_to") };
}

export function ageWords(ageS: number | null): string {
  if (ageS === null) return "an unknown time";
  if (ageS < 3600) return `${Math.max(1, Math.round(ageS / 60))} minute(s)`;
  if (ageS < 48 * 3600) return `${(ageS / 3600).toFixed(1)} hours`;
  return `${(ageS / 86400).toFixed(1)} days`;
}

function pathOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

const lower = (v: string): string => v.trim().toLowerCase();
const atomic = (v: string): string => {
  try {
    return BigInt(v.trim()).toString();
  } catch {
    return v.trim();
  }
};

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
