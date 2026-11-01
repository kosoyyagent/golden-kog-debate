# golden-kog-debate

A small TypeScript module that adds a two-sided structure debate to a token
risk analysis: two advocates argue a token's structure from measured facts
(one for a sound structure, one for a fragile structure), then a reviewer
weighs them. **This is a risk tool, never a trading tool** — no buy or sell
view, no price target, no entry or exit, no advice.

The pattern is adapted from
[TradingAgents](https://github.com/TauricResearch/TradingAgents)
(TauricResearch, Apache 2.0), without its trader or portfolio manager roles.

- Node 22, TypeScript, **zero runtime dependencies**
- One export: `debate(input, deps) -> Promise<Debate>` in `src/debate.ts`

## Call flow

```
                  ┌─────────────────────────┐
                  │        debate()         │
                  └────────────┬────────────┘
                               │
              ┌────────────────┴────────────────┐
              │  parallel route() calls         │
              │  role: sound   role: fragile    │   complexity: exec
              └────────────────┬────────────────┘
                               │ both texts + facts_text
                  ┌────────────▼────────────┐
                  │  route() role: reviewer │   complexity: apex
                  │  strict JSON answer     │
                  └────────────┬────────────┘
                               │ parse + validate
                  ┌────────────▼────────────┐
                  │        Debate           │
                  └─────────────────────────┘
```

1. `mode === 'off'` returns immediately (`status: 'off'`) with **no** route
   calls.
2. Sound and fragile advocates are called **in parallel**
   (`complexity: 'exec'`).
3. The reviewer (`complexity: 'apex'`) receives both advocate texts and the
   `facts_text`, and answers strict JSON
   `{text, weight, unknown, tension?}`.
4. Everything is validated against the rules below; failures are recorded
   in `rejected`.

## Rules

Every generated part (advocate texts and the reviewer `text`) must pass:

- every number in it appears verbatim in `facts_text`
- none of the refused trading words: *bull, bear, bullish, bearish, upside,
  downside target, undervalued, overvalued, accumulate, moon, buy now,
  sell now, price target, entry, exit, take profit, not financial advice*
- `deps.check(text)` returns no problems
- at most 180 words per advocate and 150 for the reviewer
- Latin digits only, no long dash characters

Behaviour on failure:

| case | result |
|---|---|
| advocate part fails | that part becomes exactly `No case could be written from the measured facts.`; reasons kept in `rejected`; the debate continues |
| reviewer output unparseable or fails rules | `status: 'rejected'`, all texts empty |
| a call exceeds `timeoutMs` | `status: 'timeout'`, no throw |
| `mode: 'off'` | `status: 'off'`, no route calls |
| `weight` ids | kept only if present in `input.flag_ids` |

`mode: 'shadow'` (default) runs the full flow, passes the `Debate` to
`deps.log`, and returns it with `shown: false`. `mode: 'on'` returns it with
`shown: true`. `usd` is the sum of `cost_usd` across calls. The debate never
returns or changes `level` or `points`.

## Example

```ts
import { debate } from './src/debate.js';

const d = await debate(
  {
    facts_text: 'supply 1000000 tokens\ntop holder 12 percent\nliquidity 45000 usd\nage 90 days',
    level: 'watch',
    points: 30,
    flag_ids: ['concentration', 'thin_liquidity'],
    unknown: ['team identity'],
  },
  {
    route: llmRoute,          // your model router
    mode: 'shadow',
    timeoutMs: 45000,
  },
);
// d ===
// {
//   status: 'ok', shown: false,
//   sound: 'Top holder holds 12 percent, ...',
//   fragile: 'Top holder holds 12 percent of supply 1000000, ...',
//   reviewer: 'Concentration at 12 percent with liquidity of 45000 usd is a real fragility.',
//   weight: ['concentration', 'thin_liquidity'],
//   unknown: ['team identity', 'audit coverage'],
//   tension: 'thin pool vs old age',
//   models: { sound: 'm-sound', fragile: 'm-fragile', reviewer: 'rev-1' },
//   usd: 0.03, rejected: []
// }
```

## Tests

Each test is named after the acceptance item it proves (A1–A7) and runs
fully offline with a stub `route`:

```bash
npm install   # devDeps only: typescript, @types/node
npm test      # tsc build + node --test dist/test/
```

## Attribution

Adapted from the debate pattern in
[TradingAgents](https://github.com/TauricResearch/TradingAgents)
(TauricResearch, Apache 2.0). Kept: two advocates plus a reviewer over
fixed facts. Removed: trader, portfolio manager, and any directional
output — this module produces risk structure only.
