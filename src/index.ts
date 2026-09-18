export { checkBeforePaying, readAnswer, routeVerdict, compareHeldQuote, ageWords } from "./check.ts";
export type {
  CheckInput,
  CheckOptions,
  CheckResult,
  RouteResult,
  HostResult,
  HostRoute,
  NotOnRecordResult,
  HeldQuote,
  HeldQuoteComparison,
  RecordedQuote,
  PaidDelivery,
  PaidAttempt,
} from "./check.ts";
export { verifyHead, parseMirrorTable, chainHeadOf, nextDay, renderVerification } from "./verify-head.ts";
export type { HeadVerification, MirrorRow } from "./verify-head.ts";
export {
  PUBLIC_SURFACES,
  PROBE402_ORIGIN,
  HEADS_MIRROR_REPOSITORY,
  HEADS_MIRROR_TABLE_URL,
  THIS_REPOSITORY,
  USER_AGENT,
  ENDPOINT_ID,
  DAY,
  surfaceOf,
  fetchPublic,
  gradeByIdUrl,
  gradeByUrlUrl,
  chainDayUrl,
  headsMirrorTableUrl,
  encodeResource,
} from "./public-surfaces.ts";
export type { Fetch, PublicSurface } from "./public-surfaces.ts";
export { wrapFetchWithCheck, PaymentBlocked } from "./x402-hook.ts";
export type { WrappedFetch, HookDecision, CheckHookOptions } from "./x402-hook.ts";
export {
  DEFAULT_POLICY,
  DELIVERED_OUTCOMES,
  MONEY_MOVED_OUTCOMES,
  NOTHING_PAID_OUTCOMES,
  UNCORROBORATED_OUTCOMES,
  decide,
  rule,
  signalsOf,
  recordUnavailable,
} from "./policy.ts";
export type { Policy, Ruling, Signal, SignalName, Decision } from "./policy.ts";
export { readChallenge, compareChallenge, caip2Of, EVM_NETWORK_NAMES } from "./challenge.ts";
export type { Challenge, ChallengeQuote, ChallengeComparison, FieldReading } from "./challenge.ts";
export { factsOf, renderFacts } from "./facts.ts";
export type { Fact } from "./facts.ts";
export { buildServer, serveStdio, TOOL_NAME, TOOL_DESCRIPTION } from "./mcp-server.ts";
export { VERSION } from "./version.ts";
