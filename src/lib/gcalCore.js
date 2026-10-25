/** 구글 캘린더 연동 순수 규칙. 네트워크와 저장소는 부르지 않습니다. */
import { addDaysYmd } from './date.js';
import { isSensitiveText } from './sensitive.js';

export const GCAL_VAULT = 'ssug-gyomu-gcal';
export const GCAL_TOKEN_KEY = 'ssug-gyomu-gcal-token';
export const GCAL_PENDING_KEY = 'ssug-gyomu-gcal-pending';
export const GCAL_HASH_KEY = 'ssug-gyomu-gcal-hash';
export const SCOPE_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';
export const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
export const KOK_PRIVATE_KEY = 'kokId';

export const GCAL_SYNC_ERROR = '구글 캘린더와 맞추지 못했어요. 콕 일정은 그대로 두었어요. 잠시 후 설정에서 다시 연결해 주세요.';
export const GCAL_AUTH_ERROR = '캘린더 연결이 만료됐거나 권한이 부족해요. 설정에서 다시 연결해 주세요. 콕 일정은 그대로예요.';
export const GCAL_OFFLINE_ERROR = '인터넷에 닿지 못해 구글 캘린더와 맞추지 못했어요. 콕 일정은 그대로예요.';
export const GCAL_DENIED_ERROR = '구글이 캘린더 권한을 거절했어요. 연동은 바꾸지 않았고, 콕 일정은 그대로예요.';
export const GCAL_SCRIPT_ERROR = '구글 연결 스크립트를 불러오지 못했어요. 인터넷을 확인한 뒤 다시 눌러 주세요. 콕 일정은 그대로예요.';
export const GCAL_RETRY_ERROR = '구글 연결 준비를 마쳤어요. 한 번만 더 눌러 주세요. 콕 일정은 그대로예요.';
export const GCAL_POPUP_ERROR = '구글 창이 열리지 않았어요. 팝업을 허용한 뒤 한 번 더 눌러 주세요. 콕 일정은 그대로예요.';
export const GCAL_PARTIAL_ERROR = '일부 일정을 구글에 올리지 못했어요. 콕에 적어 둔 일정은 그대로예요.';
export const GCAL_SHARED_ERROR = '공용 컴퓨터에서는 캘린더 연동을 켜지 않아요. 콕 일정은 그대로예요.';
export const GCAL_MODE_HINT = '보기만은 구글 일정을 읽기만 하고, 콕 일정도 구글에 넣기는 만든 일정과 수정·삭제를 구글에 반영해요.';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function googleClientId() {
    let value = '';
    try {
        value = import.meta.env?.VITE_GOOGLE_CLIENT_ID || '';
    } catch {
        value = '';
    }
    return String(value || '').trim();
}

export function emptyGcalState() {
    return {
        uid: '',
        enabled: false,
        mode: 'readonly',
        links: {},
        external: [],
        forwardSince: '',
        needsUploadAsk: false,
        lastError: '',
        lastSyncAt: '',
    };
}

export function scopeForMode(mode) {
    return mode === 'write' ? SCOPE_EVENTS : SCOPE_READONLY;
}

export function scopeAllows(scope, mode) {
    const need = scopeForMode(mode);
    return String(scope || '').split(/[\s+]+/).filter(Boolean).includes(need);
}

/** 아이폰 홈 화면 앱은 팝업이 앱 밖으로 새서, 같은 창 리다이렉트를 씁니다. */
export function pickTokenUx({ ios = false, standalone = false } = {}) {
    return ios && standalone ? 'redirect' : 'popup';
}

export function calendarRedirectUri(loc) {
    const origin = loc?.origin || '';
    const pathname = loc?.pathname || '/';
    if (!origin) return '';
    return `${origin}${pathname}`;
}

export function explainSyncError(status) {
    const code = Number(status);
    if (code === 401 || code === 403) return GCAL_AUTH_ERROR;
    if (!code) return GCAL_OFFLINE_ERROR;
    return GCAL_SYNC_ERROR;
}

export function explainOauthError(code) {
    if (code === 'access_denied' || code === 'interaction_required') return GCAL_DENIED_ERROR;
    if (code === 'popup_closed' || code === 'popup_failed_to_open') return GCAL_POPUP_ERROR;
    return GCAL_SYNC_ERROR;
}

export function normalizeToken(input, now = Date.now()) {
    const accessToken = String(input?.accessToken || input?.access_token || '').trim();
    if (!accessToken) return null;
    let expiresAt = Number(input?.expiresAt || 0);
    const expiresIn = Number(input?.expires_in || input?.expiresIn || 0);
    if (!expiresAt && expiresIn > 0) expiresAt = now + expiresIn * 1000;
    if (!expiresAt) expiresAt = now + 3600 * 1000;
    const scope = String(input?.scope || '').replace(/\+/g, ' ').trim();
    return { accessToken, expiresAt, scope };
}

export function tokenUsable(record, mode, now = Date.now()) {
    if (!record?.accessToken) return false;
    if (Number(record.expiresAt) <= now + 60 * 1000) return false;
    if (mode && !scopeAllows(record.scope, mode)) return false;
    return true;
}

export function parseOauthHash(hash, now = Date.now()) {
    const text = String(hash || '').replace(/^#/, '');
    if (!text || (!text.includes('access_token=') && !text.includes('error='))) return null;
    const params = new URLSearchParams(text);
    const error = params.get('error') || '';
    if (error) return { error };
    const token = normalizeToken({
        access_token: params.get('access_token'),
        expires_in: params.get('expires_in'),
        scope: params.get('scope'),
    }, now);
    return token;
}

export function isPushableKokEvent(row) {
    if (!row?.id || !row.date || !String(row.title || '').trim()) return false;
    if (row.google || row.readOnly) return false;
    if (row.localOnly) return false;
    if (String(row.id).startsWith('gcal:')) return false;
    if (isSensitiveText(`${row.title || ''} ${row.memo || ''}`)) return false;
    return true;
}

export function eventSignature(row) {
    return [
        row?.date || '',
        row?.end || '',
        row?.time || '',
        row?.endTime || '',
        row?.title || '',
        row?.memo || '',
        row?.kind || '',
    ].join('\u001f');
}

export function diffKokEvents(prev = [], next = []) {
    const before = new Map((prev || []).filter((row) => row?.id).map((row) => [String(row.id), row]));
    const after = new Map((next || []).filter((row) => row?.id).map((row) => [String(row.id), row]));
    const created = [];
    const updated = [];
    const deleted = [];
    for (const row of after.values()) {
        const old = before.get(String(row.id));
        if (!old) created.push(row);
        else if (eventSignature(old) !== eventSignature(row)) updated.push(row);
    }
    for (const row of before.values()) {
        if (!after.has(String(row.id))) deleted.push(row);
    }
    return { created, updated, deleted };
}

export function shouldPushCreate(row, { forwardSince = '', bulk = false } = {}) {
    if (!isPushableKokEvent(row)) return false;
    if (bulk) return true;
    if (!forwardSince || !row.at) return false;
    return String(row.at) >= String(forwardSince);
}

export function planModeChange(prev, nextMode) {
    const mode = nextMode === 'write' ? 'write' : 'readonly';
    return {
        mode,
        links: { ...(prev?.links || {}) },
        deleteRemote: false,
        askUpload: mode === 'write' && prev?.mode !== 'write',
    };
}

function plusMinutes(hm, minutes) {
    const [hour, minute] = hm.split(':').map(Number);
    const total = hour * 60 + minute + minutes;
    const wrapped = total >= 24 * 60;
    const mod = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
    return {
        hm: `${String(Math.floor(mod / 60)).padStart(2, '0')}:${String(mod % 60).padStart(2, '0')}`,
        wrapped,
    };
}

export function kokToGoogleEvent(row) {
    const summary = String(row.title || '일정').trim().slice(0, 200) || '일정';
    const description = [row.memo, row.kind ? `콕 ${row.kind}` : ''].filter(Boolean).join('\n').slice(0, 800);
    const extendedProperties = {
        private: {
            [KOK_PRIVATE_KEY]: String(row.id),
            kokSource: 'ssug-gyomu',
        },
    };
    if (HM.test(row.time || '')) {
        let endDate = row.end && row.end > row.date ? row.end : row.date;
        let endTime = HM.test(row.endTime || '') ? row.endTime : '';
        if (!endTime) {
            const shifted = plusMinutes(row.time, 60);
            endTime = shifted.hm;
            if (shifted.wrapped) endDate = addDaysYmd(endDate, 1);
        } else if (endDate === row.date && endTime <= row.time) {
            endDate = addDaysYmd(endDate, 1);
        }
        const body = {
            summary,
            start: { dateTime: `${row.date}T${row.time}:00+09:00`, timeZone: 'Asia/Seoul' },
            end: { dateTime: `${endDate}T${endTime}:00+09:00`, timeZone: 'Asia/Seoul' },
            extendedProperties,
        };
        if (description) body.description = description;
        return body;
    }
    const inclusive = row.end && row.end >= row.date ? row.end : row.date;
    const body = {
        summary,
        start: { date: row.date },
        end: { date: addDaysYmd(inclusive, 1) },
        extendedProperties,
    };
    if (description) body.description = description;
    return body;
}

function seoulBag(date) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    const bag = {};
    for (const part of fmt.formatToParts(date)) {
        if (part.type !== 'literal') bag[part.type] = part.value;
    }
    return {
        ymd: `${bag.year}-${bag.month}-${bag.day}`,
        hm: `${String(bag.hour).padStart(2, '0')}:${String(bag.minute).padStart(2, '0')}`,
    };
}

export function googleToExternal(item) {
    if (!item?.id || item.status === 'cancelled') return null;
    const kokId = item.extendedProperties?.private?.[KOK_PRIVATE_KEY]
        || item.extendedProperties?.private?.kokId
        || '';
    if (kokId) return null;
    const externalId = String(item.id);
    let date = '';
    let end = '';
    let time = '';
    let endTime = '';
    if (item.start?.date) {
        date = String(item.start.date);
        const exclusive = item.end?.date ? String(item.end.date) : addDaysYmd(date, 1);
        const inclusive = addDaysYmd(exclusive, -1);
        if (inclusive > date) end = inclusive;
    } else if (item.start?.dateTime) {
        const start = seoulBag(new Date(item.start.dateTime));
        date = start.ymd;
        time = start.hm;
        if (item.end?.dateTime) {
            const finish = seoulBag(new Date(item.end.dateTime));
            if (finish.ymd && finish.ymd !== date) end = finish.ymd;
            if (finish.hm && finish.hm !== time) endTime = finish.hm;
        }
    }
    if (!date) return null;
    const row = {
        id: `gcal:${externalId}`,
        externalId,
        date,
        title: String(item.summary || '구글 일정').slice(0, 80),
        memo: String(item.location || '').slice(0, 120),
        readOnly: true,
        google: true,
    };
    if (end) row.end = end;
    if (time) row.time = time;
    if (endTime) row.endTime = endTime;
    return row;
}

export function dedupeExternal(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows || []) {
        if (!row?.google || !row.externalId || !row.date) continue;
        if (seen.has(row.externalId)) continue;
        seen.add(row.externalId);
        out.push({ ...row, id: `gcal:${row.externalId}`, readOnly: true, google: true });
    }
    return out;
}

/** 학급 일정 배열은 그대로 두고, 화면에만 구글 일정을 붙입니다. */
export function mergeCalendarRows(classRows, googleRows) {
    const classes = Array.isArray(classRows) ? classRows : [];
    return [...classes, ...dedupeExternal(googleRows)];
}

export function visibleGoogleEvents(state, uid) {
    if (!state?.enabled) return [];
    if (!uid) return [];
    if (state.uid && state.uid !== uid) return [];
    return dedupeExternal(state.external);
}

export function googleWindow(ymd) {
    const start = addDaysYmd(ymd, -180);
    const end = addDaysYmd(ymd, 370);
    return {
        timeMin: `${start}T00:00:00+09:00`,
        timeMax: `${end}T00:00:00+09:00`,
    };
}
