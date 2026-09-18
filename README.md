# probe402-check

Ask probe402's public record about an x402 endpoint before your agent pays it, and re-check a
published archive head from your own terminal.

Three small tools, one repository, Apache-2.0:

- **`wrapFetchWithCheck`** — an x402 client hook. Wrap the fetch your x402 client pays through and
  every 402 is checked against probe402's record before the payment is signed, against a policy you
  write. It never touches your signer and never changes the payment.
- **`check_before_paying`** — an MCP server and a CLI. Give it the URL your agent is about to pay.
  It reads that route's free grade on probe402.com and answers: was it quoting at the newest reading,
  quoting what, has probe402 itself paid it and how was the result graded, how old is that reading
  against the route's own cadence, and the address to cite. It compares the payment request you are
  holding against the recorded one if you pass it. The decision stays with your agent's policy.
- **`verify-head`** — fetches one sealed day's head from probe402's public head table and that day's
  manifest from probe402.com, recomputes the head, and prints `LINKS` or `DOES NOT LINK` with both
  digests.

The tool reads public surfaces of probe402.com and one public git repository, and nothing else. There
is no key, no account and no payment anywhere in it.

## Use it in 60 seconds

**Claude Desktop** — add this to `claude_desktop_config.json` and restart:

```json
{
  "mcpServers": {
    "probe402-check": {
      "command": "npx",
      "args": ["-y", "probe402-check", "--mcp"]
    }
  }
}
```

**Claude Code** — one line:

```sh
claude mcp add probe402-check -- npx -y probe402-check --mcp
```

**OpenAI Agents SDK** — copy [`examples/openai-agents-tool.ts`](examples/openai-agents-tool.ts) into
your project (it is forty lines, and it builds the tool with `tool()` from `@openai/agents`, which you
install yourself):

```ts
import { Agent } from "@openai/agents";
import { checkTool } from "./openai-agents-tool.ts";

const agent = new Agent({
  name: "buyer",
  instructions: "Before paying any x402 endpoint, call check_before_paying and reason from its verdict.",
  tools: [checkTool],
});
```

Then ask for a route by URL: *check https://datastand.dev/api/data/dev-signals before I pay it.*

The `npx` forms above work once the package is on npm; until then, clone (see [Install](#install)) and
point the command at `node /absolute/path/to/probe402-check/dist/cli/mcp.js`.

## At the payment: the x402 client hook

The MCP tool answers when an agent remembers to ask. An agent has to remember. The hook does not
depend on remembering: it sits under the fetch your x402 client pays through, so every 402 is checked
**before the payment is signed**.

One import, three lines:

```ts
import { wrapFetchWithPayment } from "@x402/fetch";
import { wrapFetchWithCheck } from "probe402-check";

const fetchWithPay = wrapFetchWithPayment(wrapFetchWithCheck(fetch), client);
```

It goes *underneath* the payment wrapper, because that is where the 402 arrives. `x402-fetch` (the v1
package) composes the same way. Now any request your agent makes is checked at the moment it would
cost money:

```ts
const response = await fetchWithPay("https://datastand.dev/api/data/dev-signals");
```

What the hook does on a 402: reads the challenge (through a clone, so your client still reads it
itself), asks probe402 about that exact URL — one request, to the free grade — compares every way to
pay the 402 offers against the quote probe402 recorded, and applies your policy. Then it hands the
402 back untouched and your client signs, or it throws `PaymentBlocked` and your client never sees it.

It never touches your signer, your key or your wallet; it adds no header, removes none, and changes
no payment. A request that already carries a payment header is your client's own retry and is passed
straight through, so one payment costs one question.

### The policy is yours

The tool reports facts. What a fact is worth is your call, so each check produces named **signals**
and your policy maps each name to `allow`, `warn` or `block`. The loudest wins. These are the
defaults:

| Signal | Default | What it means |
|---|---|---|
| `never-observed-delivering` | **block** | probe402 paid this route, money moved, and no payment of its own came back with an answer |
| `payment-address-differs` | **block** | no way to pay this 402 names the payment address probe402 recorded |
| `quote-differs` | warn | the live 402 differs from the recorded quote on amount, asset, network or scheme |
| `reading-past-cadence` | warn | the newest reading is older than the cadence this route is read on |
| `newest-paid-attempt-refused` | warn | probe402's newest paid attempt was refused before settlement — nothing was paid |
| `settlement-not-corroborated` | warn | every paid attempt probe402 holds leaves it unable to say whether money moved |
| `paid-word-not-known` | warn | probe402 graded a payment with a word this version does not classify |
| `never-paid` | warn | probe402 has not paid this route, so it holds no paid-delivery reading |
| `not-quoting` | warn | the newest reading was not a payment quote |
| `no-reading` | warn | probe402 holds the route and has no reading of it in the window |
| `not-on-record` | warn | probe402 holds no record of this address |
| `host-not-route` | warn | the address names a host, so nothing here grades a route |
| `record-unavailable` | warn | probe402 could not be asked |

Two rows block, and both are about money that was actually sent: payments probe402 made that were
never answered, and a payment address that is not the one it recorded. Everything else reports.

A row probe402's own absence produces — `never-paid`, `not-on-record`, `record-unavailable` — warns
and does not block on purpose. probe402 not having looked is a fact about probe402, and it should
never be the thing that stops somebody's payment.

Change any row with one line:

```ts
const fetchWithPay = wrapFetchWithPayment(
  wrapFetchWithCheck(fetch, {
    policy: { "reading-past-cadence": "block", "never-observed-delivering": "warn" },
    onDecision: (decision) => log.info(decision.line),
  }),
  client,
);
```

`onDecision` is called with every decision before it is acted on: the ruling, every signal with its
own date, the facts underneath, probe402's whole answer, and the address to cite. `warn` lines go to
standard error unless you pass a `warn` of your own.

### Catching the block

```ts
import { PaymentBlocked } from "probe402-check";

try {
  await fetchWithPay(url);
} catch (error) {
  if (error instanceof PaymentBlocked) {
    console.error(error.decision.because);
    console.error(`the record is at ${error.decision.cite}`);
    for (const fact of error.decision.facts) console.error(`${fact.as_of ?? "no date"} ${fact.fact}`);
  }
}
```

## What probe402 measures

[probe402](https://probe402.com) is a measurement record for machine commerce. On a clock, it sends
the request an x402 or MPP endpoint documents, keeps what came back, and grades each reading by a
published rule: was a well-formed payment quote returned, what did it ask for, did the endpoint answer
without one, did it refuse probe402 as a client, or did nothing usable come back. A separate, named
tool pays a published panel of routes and grades what a paid request gets. Each closed day of the
record is sealed into a manifest whose hash is published, and each day's manifest names the day
before it, so the record forms a chain that anyone can re-check. How it probes, what it refuses to
do, and how a reading can be challenged are on [probe402.com/method](https://probe402.com/method).

Everything this tool returns is a dated reading from probe402's vantage. A reading says what a route
did when probe402 looked. It is never a statement about what the endpoint is.

## What the check asks, and what it can and cannot tell an agent

One request per check, to the free grade. For a route it returns:

| Field | What it holds |
|---|---|
| `reading` | The newest observation: the graded outcome (`Quoted`, `Answered, no quote`, `Blocked or challenged`, `Unreachable`, `Not probed`), when it was taken, its age, and whether that age is past the cadence the route is read on |
| `quote` | The recorded payment quote at that reading: scheme, network, amount in atomic units, asset address, payment address, timeout |
| `window` | The graded window (seven days on the free grade): readings held, absences probe402 filed for its own misses, how many times the quote changed, readings by outcome |
| `paid_delivery` | Whether the route is on probe402's paid panel, when it was last paid, every attempt with its date and graded word, and where that record was read from |
| `held_quote` | If you passed the 402 you are holding: which fields match the recorded quote and which differ |
| `cite` | The grade address, which carries the whole reading and its method |
| `verdict` | One line in plain words your agent can put in its own reasoning |

What it **can** tell you: whether the route was quoting when probe402 last looked and how long ago
that was; what it was asking to be paid, and whether that matches what you are being asked now;
whether probe402's own paid requests to it settled and got an answer, and when; how often the quote
moved in the window; that probe402 did not look, when that is the case, recorded as probe402's own
absence.

What it **cannot** tell you: whether the endpoint is up at this second (the reading has an age, and
the age is on it); whether your payment will be answered (a paid-delivery reading is probe402's
experience, dated); anything about a route probe402 does not hold on its list, which comes back as
`not-on-record` and says so; anything about the operator beyond what the route did on the wire.

A URL that names a host rather than a route answers the host's routes, each with its own grade
address and paid state, and grades none of them.

## Install

Node 24 or later.

```sh
git clone https://github.com/probe402/probe402-check.git
cd probe402-check
npm install      # builds dist/
npm test
```

## CLI

```sh
# by the URL you are about to pay
node dist/cli/check.js https://datastand.dev/api/data/dev-signals

# by probe402 endpoint id, comparing the 402 you hold, full JSON
node dist/cli/check.js ep_67bec7d9e13ef185 --pay-to 0x470a1b647d668d3820add26d70c8371557ff4c6b --amount 20000 --network eip155:8453 --json

# a host: its routes, each with a grade address
node dist/cli/check.js https://api.myceliasignal.com

# the readings a verdict stood on, each with its date and the address that holds it
node dist/cli/check.js ep_4d864a69497e351a --explain
```

After `npm link` (or a global install) the same commands are `probe402-check`, `probe402-check-mcp`
and `probe402-verify-head`.

## MCP (Claude Desktop, Claude Code, any MCP client)

The server speaks MCP over stdio and registers one tool, `check_before_paying`, with `url` and an
optional `held_quote` (`pay_to`, `amount_atomic`, `network`, `asset`, `scheme`).

```json
{
  "mcpServers": {
    "probe402-check": {
      "command": "npx",
      "args": ["-y", "probe402-check", "--mcp"]
    }
  }
}
```

From a clone rather than npm, the command is `node` and the argument is
`/absolute/path/to/probe402-check/dist/cli/mcp.js`; `examples/claude-mcp-config.json` holds that form.
The package is registered with the MCP registry as `io.github.probe402/probe402-check`
(`server.json` in this repository).

The same block is in [`examples/claude-mcp-config.json`](examples/claude-mcp-config.json). For
Claude Code: `claude mcp add probe402-check -- node /absolute/path/to/probe402-check/dist/cli/mcp.js`.

## OpenAI Agents SDK

The same check as a function tool, without this package depending on that SDK:
[`examples/openai-agents-tool.ts`](examples/openai-agents-tool.ts) exports `checkTool`, built with
`tool()` from `@openai/agents` and `zod`, which you install in your own project.

```ts
import { Agent, run } from "@openai/agents";
import { checkTool } from "./openai-agents-tool.ts";

const agent = new Agent({
  name: "buyer",
  instructions: "Before paying any x402 endpoint, call check_before_paying and reason from its verdict.",
  tools: [checkTool],
});
await run(agent, "Pay https://datastand.dev/api/data/dev-signals if the record supports it.");
```

## As a library

```ts
import { checkBeforePaying } from "probe402-check";

const result = await checkBeforePaying({
  url: "https://datastand.dev/api/data/dev-signals",
  held_quote: { pay_to: "0x470a1b647d668d3820add26d70c8371557ff4c6b", amount_atomic: "20000" },
});
console.log(result.verdict);
// datastand.dev GET /api/data/dev-signals was quoting 20000 atomic units of 0x8335…2913 on eip155:8453
// to 0x470a…4c6b as of 2026-09-17T02:32:23.121Z (9.4 hours ago, inside its daily cadence). The quote did
// not change across 7 reading(s) in 7 days. probe402 paid this route on 2026-09-16T17:24:16.130Z and
// graded the result "Settled and answered". The payment request you hold matches the recorded quote on
// pay_to, amount_atomic. Cite https://probe402.com/grade/ep_67bec7d9e13ef185.
```

`result.kind` is `route`, `host` or `not-on-record`; the fields are typed in `dist/index.d.ts`.

## The demos

### An agent meets three 402s and pays one, warns on one, refuses one

[`examples/agent-pays.ts`](examples/agent-pays.ts) is the hook doing its job. Three live routes on
probe402's list answer 402; the hook asks probe402 about each; the default policy lets the payment
through, warns and lets it through, and stops it. About fifteen seconds.

```sh
node examples/agent-pays.ts
```

The readings are live. The payment is not: there is no wallet, no key and no signer in that file or in
this package. The x402 client is a ten-line stand-in composed the way the published one composes, and
where the real one signs, it writes a line saying it signed — so what the run shows is the ORDER.

The three: a route probe402 pays and whose newest payment was graded *Settled and answered* goes
through; a route whose every paid attempt was *Refused before settlement* warns and goes through; a
route probe402 paid twice, both corroborated on Base, neither answered, is stopped before the signer.

### An agent asks before it pays

[`examples/agent-decides.ts`](examples/agent-decides.ts) is an agent about to pay three routes on
probe402's list. It asks, prints what probe402 says, and decides `PAY`, `HOLD` or `REFUSE` by a policy
written out at the top of the file: refuse when the 402 it holds names a different payment address or
amount from the recorded quote; hold when the reading is past cadence, was not a quote, or probe402 has
never paid the route; pay when the route was quoting inside cadence, the held request matches, and
probe402's own newest paid attempt was graded as settled.

```sh
node examples/agent-decides.ts
```

Two of the three routes are on probe402's paid panel and read `PAY`; the third is on the list and not
on the panel and reads `HOLD`. The policy is the demo's, not probe402's: the readings are what the
tool gives you, and the decision is yours to write.

## Re-checking a head

```sh
node dist/cli/verify-head.js 2026-08-21
node dist/cli/verify-head.js 2026-08-21 --next     # also checks that 2026-08-22's manifest names it
```

```
2026-08-21
  head on the public copy (25 rows through 2026-09-14): f0bca18bc38e9a7d202bedc12def262cd4a17ec61136ee07f911afc775bafc65
  sha256 of https://probe402.com/chain/2026-08-21 (109954 bytes, trailing newline stripped): f0bca18bc38e9a7d202bedc12def262cd4a17ec61136ee07f911afc775bafc65
  next day 2026-08-22 links back to 2026-08-21 f0bca18b…: NAMES IT
LINKS
```

The rule it applies: the manifest probe402.com serves at `/chain/<date>` is canonical JSON followed by
exactly one newline byte, and the head is the SHA-256 of those bytes without that newline. The public
copy of the head table is
[github.com/probe402/probe402-chain-heads](https://github.com/probe402/probe402-chain-heads), one
row per sealed day, appended and never rewritten. Exit code 0 on `LINKS`, 1 on `DOES NOT LINK`, 2 when
the check could not be made (no row yet for that day, or no manifest served).

## What it reads, and nothing else

The code forms four addresses and no others, every request goes through one function, and that
function refuses anything not on the list. A test in this repository drives the refusal with an extra
path and scans the sources for an address formed anywhere else.

- `https://probe402.com/grade/<endpoint_id>` — a route's free grade
- `https://probe402.com/grade?url=<url>` — a route's or a host's free grade, by URL
- `https://probe402.com/chain/<date>` — one sealed day's manifest
- `https://raw.githubusercontent.com/probe402/probe402-chain-heads/main/ARCHIVE-CHAIN.md` — the public head table

Requests carry the user-agent `probe402-check/<version> (+https://github.com/probe402/probe402-check)`
so probe402 can count this tool's calls apart from other callers. The free grade has a per-minute
volume wall; this tool makes one request per check.

The repository holds no part of probe402's own record, list, collector, serving code or paid
instrument, and no credential of any kind. Everything it returns is already answered on a public
address.

## Words

probe402 refuses two kinds of word on anything it publishes: a claim of primacy and a conclusion its
record does not license. A test here holds this README, every string in the sources and examples, and
every verdict the recorded answers produce to the same patterns. If a change trips it, reword; do not
loosen the pattern.

## Licence

Apache-2.0. See [LICENSE](LICENSE). The name "probe402" is not licensed with the code.
