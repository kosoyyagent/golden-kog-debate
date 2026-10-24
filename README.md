# golden-kog-debate

Two-sided structure debate module for the Golden Kog token risk agent.

A risk tool, never a trading tool: two advocates argue from measured facts —
one for a sound structure, one for a fragile structure — then a reviewer
weighs them. The debate pattern is adapted from
[TradingAgents](https://github.com/TauricResearch/TradingAgents)
(TauricResearch, Apache 2.0), without its trader or portfolio manager.

No runtime dependency. Node 22.

## Install and build

```sh
npm install
npm run build
npm test
```

## Use

```ts
import { debate } from './dist/debate.js';

const result = await debate(
  {
    facts_text: 'holders_top10_pct 42\nliquidity_usd 18300\n...',
    level: 'medium',
    points: 55,
    flag_ids: ['conc_top10', 'liq_thin'],
    unknown: ['team identity'],
  },
  {
    route: async (args) => callYourRouter(args), // -> {content, model?, cost_usd?}
    check: (text) => callerGuardProblems(text),  // optional
    mode: 'shadow',                              // 'off' | 'shadow' | 'on'
    log: (row) => auditLog(row),                 // optional
    timeoutMs: 45000,                            // optional
  },
);
```

## Call flow

1. Both advocate calls run **in parallel** (`complexity: 'exec'`), roles
   `sound` and `fragile`. Each gets the measured facts, the fired risk rule
   ids and the known unknowns.
2. The reviewer call runs after (`complexity: 'apex'`). It receives both
   advocate texts plus the facts, and answers JSON
   `{text, weight, unknown, tension?}`.
3. The returned `Debate` never contains `level` or `points` — the module
   does not change the risk score.

## Rules every part must pass

- Every number in a part must appear in `facts_text`, written the same way.
- No trading language: bull, bear, bullish, bearish, upside, downside target,
  undervalued, overvalued, accumulate, moon, buy now, sell now, price target,
  entry, exit, take profit, not financial advice.
- `deps.check(text)` must return no problems.
- At most 180 words per advocate, 150 for the reviewer.
- Latin digits only, no dash characters.

A failing advocate part becomes exactly
`"No case could be written from the measured facts."` and its reasons go to
`rejected`. A failing or unparseable reviewer gives `status: 'rejected'`
with empty texts. `weight` keeps only ids present in `flag_ids`.

## Modes and timeouts

- `mode: 'off'` makes no route call (`status: 'off'`).
- `mode: 'shadow'` (default) runs everything, passes the `Debate` to
  `deps.log`, and returns it with `shown: false`.
- `mode: 'on'` returns `shown: true`.
- A call exceeding `timeoutMs` yields `status: 'timeout'` without throwing.
- `usd` is the sum of `cost_usd` across the calls.

## Example Debate

```json
{
  "status": "ok",
  "shown": false,
  "sound": "Top 10 hold 42 percent with revoked mint and freeze authority...",
  "fragile": "Top 10 hold 42 percent of supply and liquidity_usd 18300 is thin...",
  "reviewer": "Concentration at 42 percent with liquidity_usd 18300 outweighs...",
  "weight": ["conc_top10", "liq_thin"],
  "unknown": ["team identity"],
  "tension": "Usage is real but exits are thin.",
  "models": {"sound": "m-exec", "fragile": "m-exec", "reviewer": "m-apex"},
  "usd": 0.003,
  "rejected": []
}
```

## Tests

`npm test` runs one test per acceptance item (A1–A7) in
`test/debate.test.mjs`.
