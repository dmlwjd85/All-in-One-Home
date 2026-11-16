/* 붙인 사진: 크기 맞추기, 표지 합치기, 올리기·지우기·이 기기 전용 처리, 화면 연결을 봅니다. (브라우저 없이) */
import { readFileSync } from 'node:fs';
import {
    PHOTO_DATA_MAX, PHOTO_MAX_PER_OWNER, addShrunk, clearLocalPhotos, fitSize, listPhotos, mergeRemote, newPhotoId, ownerPhotos,
    pendingWork, photoCounts, photoData, photoOwner, removeOwnerPhotos, removePhoto, syncPhotos, usePhotoCloudForTest, usePhotoVaultForTest,
} from '../src/lib/photos.js';

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };
const memVault = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); }, remove: async (k) => { m.delete(k); }, m }; };

/* 1) 순수 함수 */
ok(JSON.stringify(fitSize(4000, 3000, 1600)) === '{"w":1600,"h":1200}', '가로 사진 줄이기 크기');
ok(JSON.stringify(fitSize(3000, 4000, 1600)) === '{"w":1200,"h":1600}', '세로 사진 줄이기 크기');
ok(JSON.stringify(fitSize(800, 600, 1600)) === '{"w":800,"h":600}', '작은 사진을 키우면 안 됩니다.');
ok(photoOwner('notes', 'meet-1') === 'notes-meet-1' && photoOwner('todos', 'a') === '' && photoOwner('records', 'a b') === '', '사진 주인 키 형식');
ok(/^ph-[a-z0-9]{8,30}$/.test(newPhotoId()) && /^ph-[a-z0-9]{8,30}$/.test(newPhotoId(1, 0)), '사진 id 가 규칙의 형식과 다릅니다.');
ok(PHOTO_DATA_MAX <= 750000, '사진 글자 한도가 규칙(750000)보다 큽니다.');
{
    const index = { 'ph-aaaaaaa1': { owner: 'notes-m1', at: 2, up: 'u', has: true }, 'ph-aaaaaaa2': { owner: 'notes-m1', at: 1, up: 'u', has: true }, 'ph-aaaaaaa3': { owner: 'notes-m1', at: 3, gone: true, up: 'u' }, 'ph-aaaaaaa4': { owner: 'notes-m2', at: 1, up: '', has: true } };
    ok(ownerPhotos(index, 'notes-m1').map((p) => p.id).join() === 'ph-aaaaaaa2,ph-aaaaaaa1', '붙인 순서·지운 사진 빼기');
    const m = mergeRemote(index, [
        { id: 'ph-aaaaaaa1', owner: 'notes-m1', w: 1, h: 1, gone: true, at: 50 },
        { id: 'ph-aaaaaaa3', owner: 'notes-m1', w: 1, h: 1, gone: false, at: 40 },
        { id: 'ph-bbbbbbb1', owner: 'records-r1', w: 10, h: 20, gone: false, at: 60 },
        { id: 'ph-aaaaaaa4', owner: 'notes-m2', w: 1, h: 1, gone: true, at: 30 },
        { id: 'bad', owner: 'notes-m1', gone: false, at: 99 },
        { id: 'ph-ccccccc1', owner: 'todos-1', gone: false, at: 99 },
    ], 'u', 10);
    ok(!m.index['ph-aaaaaaa1'] && m.drop.includes('ph-aaaaaaa1'), '다른 기기에서 지운 사진이 남습니다.');
    ok(m.index['ph-aaaaaaa3']?.gone === true, '이 기기에서 지우려던 사진이 되살아납니다.');
    ok(m.index['ph-bbbbbbb1']?.up === 'u' && m.index['ph-bbbbbbb1'].has === false, '다른 기기의 새 사진 표지를 받지 못합니다.');
    ok(m.index['ph-aaaaaaa4']?.has === true, '이 기기 전용으로 내린 사진이 이 기기에서도 지워집니다.');
    ok(m.cursor === 60 && !m.index.bad && !m.index['ph-ccccccc1'], '커서 또는 형식 거르기가 틀립니다.');
    const w = pendingWork({ a: { owner: 'notes-m1', up: '', has: true }, b: { owner: 'notes-m2', up: '', has: true }, c: { owner: 'notes-m2', up: 'u', has: true }, d: { owner: 'notes-m3', up: '', has: true }, e: { owner: 'notes-m1', up: 'u', gone: true } }, 'u', (o) => (o === 'notes-m1' ? true : o === 'notes-m2' ? false : null));
    ok(w.upload.join() === 'a' && w.hide.join() === 'c' && w.remove.join() === 'e', `올리기·내리기·지우기 계획이 틀립니다: ${JSON.stringify(w)}`);
}

/* 2) 가짜 저장소·가짜 클라우드로 흐름 보기 */
{
    const vault = memVault();
    usePhotoVaultForTest(vault);
    const server = { metas: new Map(), data: new Map(), clock: 1000, puts: 0 };
    const cloud = {
        async put(uid, id, meta, data) { server.data.set(id, data); server.metas.set(id, { id, owner: meta.owner, w: meta.w, h: meta.h, gone: false, at: ++server.clock }); server.puts += 1; },
        async gone(uid, id, meta) { server.metas.set(id, { id, owner: meta.owner, w: 1, h: 1, gone: true, at: ++server.clock }); server.data.delete(id); },
        async data(uid, id) { return server.data.get(id) || ''; },
        async metas(uid, since) { return [...server.metas.values()].filter((m) => m.at >= since); },
    };
    usePhotoCloudForTest(async () => cloud);
    const who = { uid: 'u' };
    const small = { data: 'A'.repeat(500), w: 100, h: 80 };
    const a = await addShrunk('notes-m1', small, { now: 1 });
    const b = await addShrunk('notes-local', small, { now: 2 });
    ok(a.ok && b.ok && (await listPhotos('notes-m1')).length === 1, '사진을 이 기기에 붙이지 못합니다.');
    const eligible = (o) => (o === 'notes-m1' ? true : o === 'notes-local' ? false : null);
    let r = await syncPhotos(who, eligible, { force: true });
    ok(r.uploaded === 1 && server.data.has(a.id) && !server.data.has(b.id), `이 기기 전용 글의 사진을 올리거나, 올릴 사진을 안 올립니다: ${JSON.stringify(r)}`);
    r = await syncPhotos(who, eligible, { force: true });
    ok(r.uploaded === 0 && server.puts === 1, '이미 올린 사진을 다시 올립니다.');
    ok((await syncPhotos(who, eligible)).skipped === true, '1분 안에 또 받습니다(읽기 낭비).');

    /* 다른 기기: 표지만 받고, 사진 글자는 열 때 받습니다. */
    const vault2 = memVault();
    usePhotoVaultForTest(vault2);
    await clearLocalPhotos();
    await syncPhotos(who, eligible, { force: true });
    const seen = await listPhotos('notes-m1');
    ok(seen.length === 1 && !vault2.m.has(`p:${a.id}`), '다른 기기가 표지를 못 받거나, 열기 전에 사진 글자를 받습니다.');
    ok((await photoData(a.id, who)) === small.data && vault2.m.has(`p:${a.id}`), '다른 기기에서 사진을 열지 못합니다.');
    ok((await photoCounts())['notes-m1'] === 1, '사진 수 세기');
    /* 다른 기기에서 지우면 처음 기기에서도 사라집니다. */
    await removePhoto(a.id);
    ok((await listPhotos('notes-m1')).length === 0, '지운 사진이 바로 사라지지 않습니다.');
    await syncPhotos(who, eligible, { force: true });
    ok(server.metas.get(a.id).gone === true && !server.data.has(a.id), '클라우드에서 사진을 지우지 않습니다.');
    usePhotoVaultForTest(vault);
    await syncPhotos(who, eligible, { force: true });
    ok((await listPhotos('notes-m1')).length === 0 && !vault.m.has(`p:${a.id}`), '다른 기기에서 지운 사진이 처음 기기에 남습니다.');
    ok((await listPhotos('notes-local')).length === 1, '이 기기 전용 사진이 사라졌습니다.');

    /* 올린 글이 이 기기 전용으로 바뀌면 클라우드에서 내리고 이 기기에는 남깁니다. */
    const c = await addShrunk('notes-m3', small, { now: 3 });
    await syncPhotos(who, () => true, { force: true });
    ok(server.data.has(c.id), '준비: 올리기');
    r = await syncPhotos(who, (o) => (o === 'notes-m3' ? false : null), { force: true });
    ok(r.hidden === 1 && !server.data.has(c.id) && server.metas.get(c.id).gone, '이 기기 전용이 된 글의 사진이 클라우드에 남습니다.');
    await syncPhotos(who, (o) => (o === 'notes-m3' ? false : null), { force: true });
    ok((await listPhotos('notes-m3')).length === 1 && (await photoData(c.id, who)) === small.data, '클라우드에서 내린 사진이 이 기기에서도 사라졌습니다.');

    /* 한 글에 붙이는 장수, 글 지우기, 로그인 없음 */
    for (let i = 0; i < PHOTO_MAX_PER_OWNER; i += 1) await addShrunk('records-r9', small, { now: 100 + i });
    ok((await listPhotos('records-r9')).length === PHOTO_MAX_PER_OWNER, '여러 장 붙이기');
    await removeOwnerPhotos('records-r9');
    ok((await listPhotos('records-r9')).length === 0, '글을 지울 때 사진이 남습니다.');
    ok((await syncPhotos({ uid: '' }, () => true, { force: true })).skipped === true, '로그인 없이 올리려 합니다.');
    /* 서버에 닿지 못해도 이 기기 사진은 그대로 */
    usePhotoCloudForTest(async () => ({ ...cloud, metas: async () => { throw new Error('offline'); } }));
    const d = await addShrunk('notes-m1', small, { now: 500 });
    r = await syncPhotos(who, () => true, { force: true });
    ok(r.failed >= 1 && (await listPhotos('notes-m1')).some((p) => p.id === d.id), '오프라인에서 사진이 사라집니다.');
    usePhotoCloudForTest(null);
}

/* 3) 화면·규칙·검사 연결 */
const read = (p) => readFileSync(p, 'utf8');
const minutes = read('src/ui/Minutes.jsx');
const students = read('src/ui/Students.jsx');
const strip = read('src/ui/PhotoStrip.jsx');
const rules = read('firestore.rules');
ok(/<PhotoStrip owner=\{photoOwner\('notes', row\.id\)\} localOnly=/.test(minutes) && /removeOwnerPhotos\(photoOwner\('notes', row\.id\)\)/.test(minutes), '회의록 보기에 사진 줄이 없거나, 지울 때 사진을 안 지웁니다.');
ok(/<PhotoStrip owner=\{photoOwner\('records', row\.id\)\} localOnly=/.test(students) && /removeOwnerPhotos\(photoOwner\('records', row\.id\)\)/.test(students), '학생 기록에 사진 줄이 없거나, 지울 때 사진을 안 지웁니다.');
ok(/accept="image\/\*"/.test(strip) && /data-role="photo-add"/.test(strip) && /role="dialog"/.test(strip) && /photoEligible/.test(strip), '사진 줄의 붙이기·크게 보기가 없습니다.');
ok(/match \/photos\/\{pid\}/.test(rules) && /match \/photoData\/\{pid\}/.test(rules) && /d\(\)\.data\.size\(\) <= 750000/.test(rules) && /d\(\)\.at == request\.time/.test(rules), '보안 규칙에 사진 칸이 없습니다.');
ok(/clearLocalPhotos/.test(read('src/lib/db.js')), "'모두 지우기'가 이 기기 사진을 비우지 않습니다.");
ok(!/photos|photoData/.test(read('src/lib/cloud.js')), '사진이 전체 받기(동기화)에 들어가면 읽기 비용이 늘어납니다.');
ok(/check:photos/.test(read('.github/workflows/deploy-pages.yml')), 'CI에 check:photos 가 없습니다.');

if (failures.length) { console.error(`붙인 사진 검사 실패 ${failures.length}개\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('붙인 사진 검사를 통과했습니다.');
