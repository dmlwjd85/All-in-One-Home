/* 임시: 설정 문서 규칙 계산량(1000 한도) 재기. probe-rules 가지에서만 돕니다. */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { toCloudSettings } from '../src/lib/cloudShape.js';
const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const LOCAL = { level: '중', count: 10, lengths: Array(10).fill(45), locks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], cellLocks: ['mon', 'tue', 'wed', 'thu', 'fri'].flatMap((d) => Array.from({ length: 10 }, (_, i) => `${d}-${i + 1}`)), extraStarts: ['16:40', '17:30'], workStart: '08:20', workEnd: '16:40',
    extra: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, { p9: '방과후 영어', p10: '보충 수학', s9: '3-1', s10: '3-2' }])) };
const days = (y, n) => Array.from({ length: n }, (_, i) => `${y}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + Math.floor(i / 12)).padStart(2, '0')}`);
const year = (y, { winter, off = 40 }) => ({ firstStart: `${y}-03-02`, firstEnd: `${y}-07-21`, secondStart: `${y}-08-18`, ...(winter ? { winterStart: `${y}-12-31`, winterBack: `${y + 1}-02-02` } : {}), secondEnd: `${y + 1}-02-10`, ...(off ? { offDays: days(y, off) } : {}) });
const body = ({ tt = 400, years = 4, winterYears = 0, off = 40 }) => {
    const academic = {};
    for (let i = 0; i < years; i += 1) academic[2025 + i] = year(2025 + i, { winter: i < winterYears, off });
    const ttEdited = days(2026, tt).map((d, i) => d.replace('2026', String(2024 + (i % 4)))).filter((v, i, l) => l.indexOf(v) === i);
    return toCloudSettings({ profile: { settingsAt: 1767225600000, ttEdited, periodStarts: ['09:00', '09:50', '10:50', '11:40', '13:20', '14:10', '15:00', '15:50'], academic } }, LOCAL).body;
};
async function tryRules(name, rules) {
    const env = await initializeTestEnvironment({ projectId: `demo-probe-${name}`, firestore: { rules, host, port: Number(port) } });
    const fs = env.authenticatedContext('t1').firestore();
    const ok = async (opts) => { try { await setDoc(doc(fs, 'users/t1/settings/device'), body(opts)); return true; } catch { return false; } };
    const lines = [];
    for (const opts of [
        { winterYears: 0 }, { winterYears: 1 }, { winterYears: 2 }, { winterYears: 3 }, { winterYears: 4 },
        { winterYears: 4, tt: 300 }, { winterYears: 4, tt: 200 }, { winterYears: 4, tt: 0 },
        { winterYears: 4, off: 20 }, { winterYears: 4, off: 0 }, { winterYears: 0, years: 3 }, { winterYears: 3, years: 3 },
    ]) lines.push(`${name} ${JSON.stringify(opts)} => ${await ok(opts) ? 'OK' : 'DENY'}`);
    /* ttEdited 개수로 한도 찾기(겨울 0년, 4년) */
    for (const w of [0, 4]) {
        let lo = 0; let hi = 400;
        if (await ok({ winterYears: w, tt: 400 })) { lines.push(`${name} winter=${w} tt 400까지 OK`); continue; }
        while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (await ok({ winterYears: w, tt: mid })) lo = mid; else hi = mid - 1; }
        lines.push(`${name} winter=${w} 최대 tt=${lo}`);
    }
    await env.cleanup();
    return lines;
}
const out = [
    ...await tryRules('base', readFileSync(new URL('./__rules_base.rules', import.meta.url), 'utf8').replace(/'firstStart', 'firstEnd', 'secondStart', 'secondEnd', 'offDays'/, "'firstStart', 'firstEnd', 'secondStart', 'secondEnd', 'offDays', 'winterStart', 'winterBack'")),
    ...await tryRules('now', readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')),
];
console.log(out.join('\n'));
