import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debate } from '../dist/debate.js';

const FACTS = [
  'holders_top10_pct 42',
  'liquidity_usd 18300',
  'mint_authority revoked',
  'freeze_authority revoked',
  'transfers_24h 910',
].join('\n');

const INPUT = {
  facts_text: FACTS,
  level: 'medium',
  points: 55,
  flag_ids: ['conc_top10', 'liq_thin'],
  unknown: ['team identity'],
};

const SOUND = 'Top 10 hold 42 percent with revoked mint and freeze authority; ' +
  'liquidity_usd 18300 is thin but 910 transfers in 24h show live usage.';
const FRAGILE = 'Top 10 hold 42 percent of supply and liquidity_usd 18300 is ' +
  'thin; concentration plus thin books is a fragile base.';
const REVIEWER_JSON = JSON.stringify({
  text: 'Concentration at 42 percent with liquidity_usd 18300 outweighs ' +
    'revoked authorities; fragility case carries it.',
  weight: ['conc_top10', 'liq_thin', 'not_a_flag'],
  unknown: ['team identity'],
  tension: 'Usage is real but exits are thin.',
});

function okRoute(overrides = {}) {
  const calls = [];
  const route = async (args) => {
    calls.push(args);
    await new Promise((r) => setTimeout(r, 0));
    const role = args.payload.role;
    const content = role === 'sound' ? SOUND
      : role === 'fragile' ? FRAGILE
      : REVIEWER_JSON;
    return { content, model: `m-${role}`, cost_usd: 0.001, ...overrides };
  };
  return { route, calls };
}

test('A1 advocates run in parallel then reviewer gets both texts and facts', async () => {
  const { route, calls } = okRoute();
  const d = await debate(INPUT, { route });
  assert.equal(d.status, 'ok');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].payload.role, 'sound');
  assert.equal(calls[1].payload.role, 'fragile');
  assert.equal(calls[2].payload.role, 'reviewer');
  assert.equal(calls[0].complexity, 'exec');
  assert.equal(calls[2].complexity, 'apex');
  assert.ok(calls[2].payload.prompt.includes(SOUND));
  assert.ok(calls[2].payload.prompt.includes(FRAGILE));
  assert.ok(calls[2].payload.prompt.includes(FACTS));
});

test('A2 advocate number not in facts is replaced with the fixed sentence', async () => {
  const bad = SOUND + ' holders_top10_pct 99';
  const { route } = okRoute();
  const d = await debate(INPUT, {
    route: async (a) => route(a).then((r) =>
      a.payload.role === 'sound' ? { ...r, content: bad } : r),
  });
  assert.equal(d.sound, 'No case could be written from the measured facts.');
  assert.ok(d.rejected.some((x) => x.includes('99')));
});

test('A3 refused word, dash, non-Latin digit, word cap and check() all refuse', async () => {
  const cases = [
    'strong accumulate signal in the tape',
    'range 18300 \u2014 42 percent',
    'liquidity_usd \u0661\u0668\u0663\u0660\u0660 shown',
    Array(200).fill('fact').join(' '),
    'caller says this part is bad',
  ];
  for (const content of cases) {
    const { route } = okRoute();
    const d = await debate(INPUT, {
      route: async (a) => route(a).then((r) =>
        a.payload.role === 'sound' ? { ...r, content } : r),
      check: (t) => (t.includes('caller says') ? ['caller problem'] : []),
    });
    assert.equal(d.sound, 'No case could be written from the measured facts.',
      `case not refused: ${content.slice(0, 30)}`);
    assert.ok(d.rejected.length > 0);
  }
});

test('A4 reviewer JSON parsed; weight keeps only known flag ids; bad JSON rejects', async () => {
  const { route } = okRoute();
  const d = await debate(INPUT, { route });
  assert.deepEqual(d.weight, ['conc_top10', 'liq_thin']);
  assert.equal(d.tension, 'Usage is real but exits are thin.');

  const d2 = await debate(INPUT, {
    route: async (a) => route(a).then((r) =>
      a.payload.role === 'reviewer' ? { ...r, content: 'not json at all' } : r),
  });
  assert.equal(d2.status, 'rejected');
  assert.equal(d2.sound, '');
  assert.equal(d2.fragile, '');
});

test('A5 a call over timeoutMs gives status timeout without throwing', async () => {
  const d = await debate(INPUT, {
    route: async () => new Promise((r) => setTimeout(() => r({ content: SOUND }), 50)),
    timeoutMs: 5,
  });
  assert.equal(d.status, 'timeout');
});

test('A6 modes: off makes no call, shadow logs and hides, on shows, usd sums', async () => {
  let calls = 0;
  const route = async () => { calls++; return { content: SOUND }; };
  const off = await debate(INPUT, { route, mode: 'off' });
  assert.equal(calls, 0);
  assert.equal(off.status, 'off');

  const { route: r2 } = okRoute();
  let logged = null;
  const shadow = await debate(INPUT, { route: r2, log: (row) => { logged = row; } });
  assert.equal(shadow.shown, false);
  assert.ok(logged);
  const on = await debate(INPUT, { route: r2, mode: 'on' });
  assert.equal(on.shown, true);
  assert.ok(Math.abs(on.usd - 0.003) < 1e-9);
});

test('A7 debate never returns level or points', async () => {
  const { route } = okRoute();
  const d = await debate(INPUT, { route });
  assert.ok(!('level' in d));
  assert.ok(!('points' in d));
});
