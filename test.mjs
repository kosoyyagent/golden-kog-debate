import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDebate } from './index.mjs';

const good = { holder_concentration_pct: 8, liquidity_usd: 250000, top10_pct: 20, contract_flags: [], days_live: 200 };
const bad  = { holder_concentration_pct: 60, liquidity_usd: 3000, top10_pct: 80, contract_flags: ['mintable', 'pausable'], days_live: 5 };

test('sound facts produce sound-leaning verdict', () => {
  const r = runDebate(good);
  assert.ok(r.for.length > r.against.length);
  assert.match(r.verdict.summary, /sound/);
});

test('fragile facts produce fragile-leaning verdict', () => {
  const r = runDebate(bad);
  assert.ok(r.against.length > r.for.length);
  assert.match(r.verdict.summary, /fragile/);
});

test('every claim cites a measured fact field', () => {
  const r = runDebate(bad);
  for (const side of ['for', 'against'])
    for (const c of r[side])
      assert.ok(c.field in bad, `claim cites unknown field ${c.field}`);
});

test('no trading output anywhere (lint guard)', () => {
  const src = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8') +
              JSON.stringify(runDebate(bad));
  for (const banned of ['buy ', 'sell ', 'price target', 'entry', 'exit price', 'long ', 'short '])
    assert.ok(!src.toLowerCase().includes(banned.trimEnd() + ' '), `banned term: ${banned}`);
  const v = runDebate(bad).verdict;
  for (const k of Object.keys(v)) assert.ok(!/price|entry|exit|buy|sell/i.test(k));
});

test('deterministic for the same input', () => {
  assert.deepEqual(runDebate(good), runDebate(good));
});
