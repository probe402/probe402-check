/**
 * THE 402 THE AGENT IS HOLDING, READ OFF THE WIRE.
 *
 * When an x402 client meets a 402, the body carries what the endpoint is asking to be paid. That is
 * the live quote. probe402 holds a recorded quote from the last time it looked. Comparing the two is
 * the whole reason this tool is worth putting at the payment rather than beside it — the agent no
 * longer has to remember to pass the payment request in, because the payment request is right there.
 *
 * Two body shapes are read, both from the published packages rather than from a guess:
 *   - x402 v1 (`x402-fetch` 1.2.0): `{ x402Version, accepts: [{ scheme, network, maxAmountRequired,
 *     resource, payTo, asset, maxTimeoutSeconds }] }`, where `network` is a NAME (`base`).
 *   - x402 v2 (`@x402/fetch` 2.26.0): `{ x402Version, resource: { url }, accepts: [{ scheme, network,
 *     amount, asset, payTo, maxTimeoutSeconds }] }`, where `network` is CAIP-2 (`eip155:8453`).
 *
 * A challenge may offer SEVERAL ways to pay, and the client's own selector picks one. This file does
 * not guess which: it reads them all, and the comparison asks whether the recorded quote is among
 * them. A field is reported as different when NO offered way to pay matches it, and as not compared
 * when the two spellings cannot be put side by side — never as different because we could not read it.
 */
import type { RecordedQuote } from "./check.ts";

/** One way to pay, as the 402 offered it. */
export type ChallengeQuote = {
  scheme: string | null;
  /** CAIP-2 where the served value can be put in CAIP-2, otherwise `null`. */
  network: string | null;
  /** Exactly what the 402 said, whatever spelling that was. */
  network_as_served: string | null;
  amount_atomic: string | null;
  asset: string | null;
  pay_to: string | null;
  max_timeout_s: number | null;
};

export type Challenge = {
  x402_version: number | null;
  /** The resource the 402 names, when it names one. */
  resource: string | null;
  accepts: ChallengeQuote[];
};

/**
 * The network names x402 v1 spells, and the chain they mean. Copied from the published `x402`
 * package's own `EvmNetworkToChainId` (1.2.0). A name outside this table is left as it was served
 * and compared as not comparable, which is the honest reading of "we have no way to line these up".
 */
export const EVM_NETWORK_NAMES: ReadonlyArray<readonly [string, number]> = [
  ["abstract", 2741],
  ["abstract-testnet", 11124],
  ["base-sepolia", 84532],
  ["base", 8453],
  ["avalanche-fuji", 43113],
  ["avalanche", 43114],
  ["iotex", 4689],
  ["sei", 1329],
  ["sei-testnet", 1328],
  ["polygon", 137],
  ["polygon-amoy", 80002],
  ["peaq", 3338],
  ["story", 1514],
  ["educhain", 41923],
  ["skale-base-sepolia", 324705682],
];

/**
 * A network as CAIP-2, or `null` when this spelling cannot be put in CAIP-2.
 *
 * A value that already carries a namespace keeps its reference exactly as served — a Solana
 * reference is a base58 genesis hash and case is part of it — while the namespace is case-folded,
 * because CAIP-2 says the namespace is lower case.
 */
export function caip2Of(network: string | null): string | null {
  if (network === null) return null;
  const value = network.trim();
  if (value === "") return null;
  const colon = value.indexOf(":");
  if (colon > 0) {
    const namespace = value.slice(0, colon).toLowerCase();
    const reference = value.slice(colon + 1);
    return /^[a-z0-9-]{3,8}$/.test(namespace) && /^[a-zA-Z0-9-]{1,32}$/.test(reference) ? `${namespace}:${reference}` : null;
  }
  const row = EVM_NETWORK_NAMES.find(([name]) => name === value.toLowerCase());
  return row === undefined ? null : `eip155:${row[1]}`;
}

/** Read a 402 body into the ways to pay it offers. `null` when it is not an x402 challenge. */
export function readChallenge(body: unknown): Challenge | null {
  const root = obj(body);
  const accepts = Array.isArray(root["accepts"]) ? (root["accepts"] as unknown[]) : null;
  if (accepts === null) return null;
  const resourceField = root["resource"];
  const resource = typeof resourceField === "string" ? resourceField : str(obj(resourceField)["url"]);
  const quotes = accepts.map((entry) => readQuote(obj(entry)));
  return {
    x402_version: num(root["x402Version"]),
    resource: resource ?? str(obj(accepts[0])["resource"]),
    accepts: quotes,
  };
}

function readQuote(entry: Record<string, unknown>): ChallengeQuote {
  const served = str(entry["network"]);
  return {
    scheme: str(entry["scheme"]),
    network: caip2Of(served),
    network_as_served: served,
    // v2 says `amount`; v1 says `maxAmountRequired`. Both are atomic units of `asset`.
    amount_atomic: str(entry["amount"]) ?? str(entry["maxAmountRequired"]) ?? numAsString(entry["amount"]) ?? numAsString(entry["maxAmountRequired"]),
    asset: str(entry["asset"]),
    pay_to: str(entry["payTo"]),
    max_timeout_s: num(entry["maxTimeoutSeconds"]),
  };
}

/** How one field of the recorded quote stood against the ways to pay the 402 offered. */
export type FieldReading = "same" | "different" | "not-compared";

export type ChallengeComparison = {
  /** How many ways to pay the 402 offered. */
  offered: number;
  /** Field by field, against the offered ways to pay taken together. */
  fields: Record<"pay_to" | "amount_atomic" | "network" | "asset" | "scheme", FieldReading>;
  /** The fields no offered way to pay matched. */
  different: string[];
  /** The fields that could not be put side by side, and are therefore neither. */
  not_compared: string[];
  /** The recorded payment address is not among the addresses the 402 offers. */
  pay_to_differs: boolean;
  /** The offered way to pay whose payment address is the recorded one, when there is one. */
  matching: ChallengeQuote | null;
};

const FIELDS = ["pay_to", "amount_atomic", "network", "asset", "scheme"] as const;

/**
 * The recorded quote against every way to pay the 402 offers.
 *
 * A field reads `same` when at least one offered way to pay carries the recorded value, `different`
 * when they all carry a value that is readable and is not it, and `not-compared` when neither side
 * has a value this code can line up — a missing field, or two spellings of a network with no way
 * between them.
 */
export function compareChallenge(challenge: Challenge, recorded: RecordedQuote | null): ChallengeComparison {
  const fields = {} as Record<(typeof FIELDS)[number], FieldReading>;
  for (const field of FIELDS) {
    const recordedValue = normalise(field, recorded === null ? null : recorded[field] ?? null);
    if (recordedValue === null || challenge.accepts.length === 0) {
      fields[field] = "not-compared";
      continue;
    }
    const offered = challenge.accepts.map((quote) => normalise(field, valueOf(quote, field)));
    if (offered.every((value) => value === null)) fields[field] = "not-compared";
    else fields[field] = offered.some((value) => value !== null && value === recordedValue) ? "same" : "different";
  }
  const different = FIELDS.filter((field) => fields[field] === "different");
  const recordedPayTo = normalise("pay_to", recorded?.pay_to ?? null);
  const matching =
    recordedPayTo === null ? null : challenge.accepts.find((quote) => normalise("pay_to", quote.pay_to) === recordedPayTo) ?? null;
  return {
    offered: challenge.accepts.length,
    fields,
    different: [...different],
    not_compared: FIELDS.filter((field) => fields[field] === "not-compared"),
    pay_to_differs: fields["pay_to"] === "different",
    matching,
  };
}

function valueOf(quote: ChallengeQuote, field: (typeof FIELDS)[number]): string | null {
  if (field === "network") return quote.network;
  return quote[field];
}

function normalise(field: (typeof FIELDS)[number], value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (field === "amount_atomic") {
    try {
      return BigInt(trimmed).toString();
    } catch {
      return trimmed;
    }
  }
  if (field === "network") return caip2Of(trimmed);
  return trimmed.toLowerCase();
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function numAsString(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}
