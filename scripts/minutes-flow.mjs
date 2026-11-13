/*
 * 회의록 저장 흐름 동작 검사(db.js 를 가짜 클라우드로 실제 실행).
 * check-minutes.mjs 가 원본과 변이 사본(src 전체 복사)에 똑같이 돌립니다.
 */
function memStore() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function plain() {
    const map = new Map();
    return { map, get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v); }, del: async (k) => { map.delete(k); } };
}

/** 실패 목록(빈 배열이면 통과). dbUrl 은 불러올 db.js 주소입니다. */
export async function flowSuite(dbUrl) {
    const bad = [];
    const ok = (cond, msg) => { if (!cond) bad.push(msg); };
    let round = 0;
    async function open() {
        round += 1;
        globalThis.localStorage = memStore();
        const db = await import(`${dbUrl}?flow=${round}`);
        db.useVaultsForTest(plain(), plain(), plain());
        const cloud = { offline: false, known: new Set(), tombs: new Set() };
        db.useCloudForTest({
            push: async () => ({ ok: true }), pull: async () => null, remove: async () => ({ ok: true }),
            minutesPeek: async (uid, ids) => (cloud.offline ? null : Object.fromEntries(ids.map((id) => [id, cloud.known.has(id) || cloud.tombs.has(id)]))),
            tomb: async (uid, ids) => { if (cloud.offline) return []; ids.forEach((id) => cloud.tombs.add(id)); return ids; },
            available: () => true,
        });
        await db.boot('');
        db.useAuthForTest('u1');
        return { db, cloud };
    }
    const todos = (db, title) => db.snapshot().todos.filter((t) => !title || t.title === title);

    /* 1. 저장하면 분명한 줄은 바로 등록, 상대 날짜는 회의록 날짜 기준(U3·U5). */
    {
        const { db } = await open();
        const r = await db.registerMinutes({ id: 'meet-1', title: '학년회의', date: '2030-01-10', text: '할 일\n- 내일까지 가정통신문 제출' });
        const t = todos(db, '가정통신문 제출');
        ok(r.count === 1 && t.length === 1, `저장할 때 할 일을 등록하지 않습니다: ${JSON.stringify(r)}`);
        ok(t[0]?.due === '2030-01-11', `'내일'을 회의록 날짜(2030-01-10) 기준으로 세지 않습니다: ${t[0]?.due}`);
        const again = await db.registerMinutes({ id: 'meet-1', title: '학년회의', date: '2030-01-10', text: '할 일\n- 내일까지 가정통신문 제출', prev: { text: '할 일\n- 내일까지 가정통신문 제출', date: '2030-01-10' } });
        ok(again.count === 0 && todos(db, '가정통신문 제출').length === 1, '같은 회의록을 다시 저장하면 또 만듭니다.');
    }
    /* 2. 다른 기기에서 지운(묘비) 항목은 다시 만들지 않습니다(U6). */
    {
        const { db, cloud } = await open();
        const text = '할 일\n- 2030-01-20까지 출결 서류 제출';
        const { minutesCandidates, minutesNow } = await import(dbUrl.replace(/db\.js$/, 'minutesExtract.js'));
        const id = minutesCandidates(text, 'meet-2', { now: minutesNow('2030-01-10') }).auto[0]?.id;
        cloud.tombs.add(id);
        const r = await db.registerMinutes({ id: 'meet-2', date: '2030-01-10', text });
        ok(id && r.count === 0 && !todos(db, '출결 서류 제출').length, '다른 기기에서 지운 할 일을 되살립니다.');
    }
    /* 3. 오프라인(확인 실패)이면 '모름'으로 미루고, 연결되면 다시 확인해 등록합니다(P1). */
    {
        const { db, cloud } = await open();
        const text = '할 일\n- 2030-01-20까지 출결 서류 제출\n- 2030-01-21까지 상담 기록 정리';
        const { minutesCandidates, minutesNow } = await import(dbUrl.replace(/db\.js$/, 'minutesExtract.js'));
        const ids = minutesCandidates(text, 'meet-3', { now: minutesNow('2030-01-10') }).auto.map((i) => i.id);
        cloud.offline = true;
        const r = await db.registerMinutes({ id: 'meet-3', date: '2030-01-10', text });
        ok(r.count === 0 && r.deferred === 2 && todos(db).length === 0, `오프라인에서 확인 없이 바로 등록합니다(지운 항목이 되살아남): ${JSON.stringify({ count: r.count, deferred: r.deferred })}`);
        cloud.offline = false;
        cloud.tombs.add(ids[0]);
        const n = await db.settleMinutesPending();
        ok(n === 1 && !todos(db, '출결 서류 제출').length && todos(db, '상담 기록 정리').length === 1, `연결된 뒤 다시 확인해 등록하지 않습니다(등록 ${n}).`);
        ok(Object.keys((await import(dbUrl.replace(/db\.js$/, 'minutesExtract.js'))).readMinutesPending()).length === 0, '미룬 등록이 끝난 뒤에도 남아 있습니다.');
        ok(await db.settleMinutesPending() === 0 && todos(db, '상담 기록 정리').length === 1, '미룬 등록을 두 번 합니다.');
    }
    /* 4. 노란 카드에서 뺀 결정은 묘비로 남기고, 오프라인이면 대기열에 두었다가 다시 씁니다(U7·Q1). */
    {
        const { db, cloud } = await open();
        const items = [{ id: 'mt-x-aaa', kind: '할 일', title: '가', include: false }, { id: 'mt-x-bbb', kind: '할 일', title: '나', include: false }];
        let r = await db.finishMinutesAsk('meet-4', items, []);
        await r.declined;
        ok(cloud.tombs.has('mt-x-aaa') && cloud.tombs.has('mt-x-bbb'), '노란 카드에서 뺀 결정을 다른 기기에 알리지 않습니다.');
        cloud.offline = true;
        r = await db.finishMinutesAsk('meet-5', [{ id: 'mt-y-ccc', kind: '할 일', title: '다', include: false }], []);
        await r.declined;
        ok(!cloud.tombs.has('mt-y-ccc'), '검사 준비: 오프라인인데 묘비가 써졌습니다.');
        cloud.offline = false;
        await db.settleMinutesPending();
        ok(cloud.tombs.has('mt-y-ccc'), '오프라인에서 뺀 결정을 연결된 뒤 다시 쓰지 않습니다.');
    }
    /* 5. 줄을 고쳐 다시 저장: 손대지 않은 옛 항목은 정리, 사용자가 고친 항목은 그대로(T1·T2). */
    {
        const { db } = await open();
        const v1 = '할 일\n- 2030-01-20까지 출결 서류 제출';
        const v2 = '할 일\n- 2030-01-22까지 출결 서류 제출';
        await db.registerMinutes({ id: 'meet-6', date: '2030-01-10', text: v1 });
        const r = await db.registerMinutes({ id: 'meet-6', date: '2030-01-10', text: v2, prev: { text: v1, date: '2030-01-10' } });
        const t = todos(db, '출결 서류 제출');
        ok(t.length === 1 && t[0].due === '2030-01-22' && r.tidied === 1, `고친 줄이 중복으로 남습니다: ${JSON.stringify(t.map((x) => x.due))}`);
        const v3 = '할 일\n- 2030-01-25까지 출결 서류 제출';
        await db.saveTextItem('todos', { ...t[0], title: '출결 서류 제출(교감 확인)' });
        await db.registerMinutes({ id: 'meet-6', date: '2030-01-10', text: v3, prev: { text: v2, date: '2030-01-10' } });
        ok(todos(db, '출결 서류 제출(교감 확인)').length === 1, '사용자가 고친 항목을 회의록 수정이 지웠습니다.');
        ok(todos(db, '출결 서류 제출').length === 1, '고친 줄의 새 항목이 없습니다.');
    }
    return bad;
}
