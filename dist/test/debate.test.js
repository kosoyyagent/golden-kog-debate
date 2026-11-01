import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { debate } from '../src/debate.js';
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const FACTS = [
    'supply 1000000 tokens',
    'top holder 12 percent',
    'liquidity 45000 usd',
    'age 90 days',
].join('\n');
const INPUT = {
    facts_text: FACTS,
    level: 'watch',
    points: 30,
    flag_ids: ['concentration', 'thin_liquidity'],
    unknown: ['team identity'],
};
function okAdvocate(text) {
    return async (args) => {
        if (args.payload.role === 'reviewer') {
            return {
                content: JSON.stringify({
                    text: 'Concentration at 12 percent with liquidity of 45000 usd is a real fragility; the rest of the structure reads ordinary.',
                    weight: ['concentration', 'thin_liquidity', 'bogus_flag'],
                    unknown: ['audit coverage'],
                    tension: 'thin pool vs old age',
                }),
                model: 'rev-1',
                cost_usd: 0.02,
            };
        }
        return { content: text, model: 'm-' + args.payload.role, cost_usd: 0.01 };
    };
}
const SOUND_OK = 'Top holder holds 12 percent, liquidity is 45000 usd, age 90 days: distribution risk is bounded and the pool is not empty.';
const FRAGILE_OK = 'Top holder holds 12 percent of supply 1000000, a single wallet that can move the thin 45000 usd pool.';
const REVIEWER_JSON = JSON.stringify({
    text: 'Concentration at 12 percent with liquidity of 45000 usd is a real fragility.',
    weight: ['concentration'],
    unknown: [],
});
test('A1: advocates run in parallel with roles sound/fragile, then reviewer gets both texts and facts', async () => {
    const calls = [];
    const startOrder = [];
    const route = async (args) => {
        calls.push(args);
        startOrder.push(args.payload.role);
        if (args.payload.role === 'reviewer') {
            assert.ok(args.payload.prompt.includes('Sound case'), 'reviewer prompt carries sound text');
            assert.ok(args.payload.prompt.includes('Fragile case'), 'reviewer prompt carries fragile text');
            assert.ok(args.payload.prompt.includes(FACTS), 'reviewer prompt carries facts_text');
            return { content: REVIEWER_JSON, cost_usd: 0.02 };
        }
        await new Promise((r) => setTimeout(r, 30));
        return { content: args.payload.role === 'sound' ? SOUND_OK : FRAGILE_OK, cost_usd: 0.01 };
    };
    const d = await debate(INPUT, { route, mode: 'on' });
    assert.equal(d.status, 'ok');
    // first two calls must both be advocates, and both started before reviewer
    assert.deepEqual(startOrder.slice(0, 2).sort(), ['fragile', 'sound']);
    assert.equal(startOrder[2], 'reviewer');
    const roles = calls.map((c) => c.payload.role);
    assert.deepEqual([...roles.slice(0, 2)].sort(), ['fragile', 'sound']);
    assert.equal(roles[2], 'reviewer');
    // advocate complexity exec, reviewer apex
    assert.equal(calls[0].complexity, 'exec');
    assert.equal(calls[2].complexity, 'apex');
    assert.equal(calls[0].task_type, 'risk_debate');
    assert.equal(calls[0].constitutional_flag, false);
    assert.equal(calls[0].agent_id, 'golden-kog');
});
test('A2: number not in facts_text replaces advocate and drops a bad reviewer', async () => {
    const badNum = '999';
    const d1 = await debate(INPUT, {
        route: okAdvocate(SOUND_OK + ' Also ' + badNum + ' percent.'),
        mode: 'on',
    });
    assert.equal(d1.status, 'ok'); // reviewer still passed
    assert.equal(d1.sound, 'No case could be written from the measured facts.');
    assert.ok(d1.rejected.some((r) => r.includes(badNum)));
    // reviewer with a foreign number rejects the whole debate
    const routeBadReviewer = async (args) => {
        if (args.payload.role === 'reviewer') {
            return { content: JSON.stringify({ text: 'Sees 999 percent risk.', weight: [], unknown: [] }) };
        }
        return { content: args.payload.role === 'sound' ? SOUND_OK : FRAGILE_OK };
    };
    const d2 = await debate(INPUT, { route: routeBadReviewer, mode: 'on' });
    assert.equal(d2.status, 'rejected');
    assert.equal(d2.sound, '');
    assert.equal(d2.reviewer, '');
    assert.ok(d2.rejected.some((r) => r.includes('999')));
});
test('A3: refused term, long dash, non Latin digit, word overflow and deps.check refuse the part', async () => {
    const cases = [
        [SOUND_OK + ' Looks bullish here.', /refused term: bull/],
        [SOUND_OK + ' Entry now.', /refused term: entry/],
        [SOUND_OK + ' A long dash \u2014 here.', /long dash/],
        [SOUND_OK + ' Weird digit \u0665.', /non Latin digit/],
        [Array(200).fill('word').join(' '), /over 180 words/],
    ];
    for (const [bad, re] of cases) {
        const d = await debate(INPUT, {
            route: async (args) => {
                if (args.payload.role === 'reviewer')
                    return { content: REVIEWER_JSON };
                return { content: args.payload.role === 'sound' ? bad : FRAGILE_OK };
            },
            mode: 'on',
        });
        assert.equal(d.sound, 'No case could be written from the measured facts.', `case: ${bad.slice(0, 40)}`);
        assert.ok(d.rejected.some((r) => re.test(r)), `expected ${re} in ${d.rejected}`);
    }
    // deps.check failure
    const d = await debate(INPUT, {
        route: async (args) => args.payload.role === 'reviewer'
            ? { content: REVIEWER_JSON }
            : { content: args.payload.role === 'sound' ? SOUND_OK : FRAGILE_OK },
        mode: 'on',
        check: (t) => (t === SOUND_OK ? ['custom guard problem'] : []),
    });
    assert.equal(d.sound, 'No case could be written from the measured facts.');
    assert.ok(d.rejected.some((r) => r.includes('custom guard problem')));
});
test('A4: reviewer JSON parsed; weight keeps only known flag ids; unparseable JSON rejects', async () => {
    const d = await debate(INPUT, { route: okAdvocate(SOUND_OK), mode: 'on' });
    assert.equal(d.status, 'ok');
    assert.deepEqual(d.weight, ['concentration', 'thin_liquidity']);
    assert.ok(!d.weight.includes('bogus_flag'));
    assert.equal(d.tension, 'thin pool vs old age');
    assert.deepEqual(d.unknown.sort(), ['audit coverage', 'team identity'].sort());
    const routeBadJson = async (args) => args.payload.role === 'reviewer'
        ? { content: 'not json at all' }
        : { content: args.payload.role === 'sound' ? SOUND_OK : FRAGILE_OK };
    const d2 = await debate(INPUT, { route: routeBadJson, mode: 'on' });
    assert.equal(d2.status, 'rejected');
    assert.equal(d2.reviewer, '');
});
test('A5: a call over timeoutMs gives status timeout without throwing', async () => {
    const route = async (args) => {
        if (args.payload.role === 'reviewer')
            return { content: REVIEWER_JSON };
        await new Promise((r) => setTimeout(r, 200));
        return { content: SOUND_OK };
    };
    const d = await debate(INPUT, { route, mode: 'on', timeoutMs: 40 });
    assert.equal(d.status, 'timeout');
});
test('A6: mode off makes no call; shadow logs and returns shown false; on returns shown true', async () => {
    let calls = 0;
    const route = async (args) => {
        calls++;
        if (args.payload.role === 'reviewer')
            return { content: REVIEWER_JSON, cost_usd: 0.01 };
        return { content: args.payload.role === 'sound' ? SOUND_OK : FRAGILE_OK, cost_usd: 0.01 };
    };
    const off = await debate(INPUT, { route, mode: 'off' });
    assert.equal(off.status, 'off');
    assert.equal(calls, 0);
    assert.equal(off.shown, false);
    const logged = [];
    const shadow = await debate(INPUT, { route, mode: 'shadow', log: (r) => logged.push(r) });
    assert.equal(shadow.status, 'ok');
    assert.equal(shadow.shown, false);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].status, 'ok');
    const on = await debate(INPUT, { route, mode: 'on' });
    assert.equal(on.shown, true);
    assert.ok(Math.abs(on.usd - 0.03) < 1e-9, `usd sum, got ${on.usd}`);
});
test('A7: README shows call flow, rules, an example Debate and credits TradingAgents', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    assert.match(readme, /call flow/i);
    assert.match(readme, /rules/i);
    assert.match(readme, /"status"|status: 'ok'/);
    assert.match(readme, /TradingAgents/);
});
