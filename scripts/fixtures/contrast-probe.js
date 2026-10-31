// check-browser 밝은 화면 글자 대비 검사가 페이지 안에서 부릅니다. 글자색 alpha × 자신·조상 opacity × 조상 바탕색·그라데이션 멈춤점을 실제로 섞어, 가장 나쁜 조합으로 잽니다.
// 화면을 찍어 재는 방식이 아니라 계산한 색으로 재므로 opacity·반투명 글자를 빼먹지 않습니다. 퇴근 타이머 키캡(.leave-key)은 check-browser 의 퇴근 타이머 픽셀 검사가 따로 맡아 건너뜁니다.
window.__contrastProbe = function (opts = {}) {
    const skip = opts.skip || '.leave-key';
    const parse = (s) => {
        const m = String(s).match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const over = (top, back) => { const a = top[3]; return [top[0] * a + back[0] * (1 - a), top[1] * a + back[1] * (1 - a), top[2] * a + back[2] * (1 - a), 1]; };
    const mix = (c, back, o) => (o >= 1 ? c : [c[0] * o + back[0] * (1 - o), c[1] * o + back[1] * (1 - o), c[2] * o + back[2] * (1 - o), 1]);
    const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    const key = (c) => c.slice(0, 3).map((v) => Math.round(v)).join(',');
    const layerCache = new Map();
    function variants(el) {
        if (layerCache.has(el)) return layerCache.get(el);
        const st = getComputedStyle(el);
        const bg = parse(st.backgroundColor) || [0, 0, 0, 0];
        const imgs = [];
        const image = st.backgroundImage;
        if (image && image !== 'none') {
            // 여러 겹: 쉼표를 괄호 밖에서만 나눕니다.
            let depth = 0; let cur = '';
            for (const ch of image) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { imgs.push(cur); cur = ''; } else cur += ch; }
            if (cur.trim()) imgs.push(cur);
        }
        const stopLists = imgs.map((g) => (g.includes('gradient') ? (g.match(/rgba?\([^)]+\)/g) || []).map(parse) : null)).filter(Boolean);
        let combos = [[]];
        for (const list of stopLists.reverse()) { // 아래 겹부터
            const next = [];
            for (const c of combos) for (const s of list) next.push([...c, s]);
            combos = next.slice(0, 24);
        }
        const out = combos.map((stops) => (back) => { let c = over(bg, back); for (const s of stops) c = over(s, c); return c; });
        layerCache.set(el, out);
        return out;
    }
    function chainOf(el) { const c = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) c.unshift(n); return c; }
    function pairs(chain, i, backdrop, ink) {
        const node = chain[i];
        const o = Number(getComputedStyle(node).opacity);
        const res = new Map();
        for (const v of variants(node)) {
            const inner = v(backdrop);
            const sub = i === chain.length - 1 ? [[inner, over(ink, inner)]] : pairs(chain, i + 1, inner, ink);
            for (const [b, t] of sub) { const pb = mix(b, backdrop, o); const pt = mix(t, backdrop, o); res.set(key(pb) + '|' + key(pt), [pb, pt]); }
            if (res.size > 32) break;
        }
        return [...res.values()];
    }
    const items = [];
    const seen = new Set();
    function visible(el) {
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return false;
        const st = getComputedStyle(el);
        if (st.visibility !== 'visible') return false;
        let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
        if (op < 0.05) return false;
        // 잘라 숨긴 글(sr-only)
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.clip && s.clip !== 'auto' && /rect\(0/.test(s.clip)) return false; }
        return true;
    }
    function judge(el, text, color, kind) {
        if (el.closest(skip)) return;
        const st = getComputedStyle(el);
        const ink = parse(color);
        if (!ink || ink[3] === 0) return;
        const size = parseFloat(st.fontSize); const weight = Number(st.fontWeight) || 400;
        const large = size >= 24 || (weight >= 700 && size >= 18.66);
        const need = large ? 3 : 4.5;
        const ps = pairs(chainOf(el), 0, [255, 255, 255, 1], ink);
        let worst = null;
        for (const [b, t] of ps) { const r = ratio(b, t); if (!worst || r < worst.r) worst = { r, b, t }; }
        const disabled = Boolean(el.closest(':disabled, [aria-disabled="true"]'));
        const cls = (el.className && typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 3).join('.');
        const path = []; for (let n = el, k = 0; n && n.nodeType === 1 && k < 4; n = n.parentElement, k++) { const c = typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; path.unshift(n.tagName.toLowerCase() + c); }
        items.push({ kind, text: text.slice(0, 30), tag: el.tagName.toLowerCase(), cls, path: path.join('>'), color: st.color, ink: hex(ink) + (ink[3] < 1 ? `@${ink[3]}` : ''), text_px: hex(worst.t), bg_px: hex(worst.b), ratio: Math.round(worst.r * 100) / 100, need, size, weight, disabled, pass: worst.r >= need - 0.005 });
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const emojiOnly = /^[\s\p{Extended_Pictographic}\u200d\ufe0f·•|/,.:()\-~+×✓✕←→↑↓▲▼▶◀…]+$/u;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent.replace(/\s+/g, ' ').trim();
        if (!t || emojiOnly.test(t)) continue;
        const el = n.parentElement;
        if (!el || seen.has(el)) continue;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'OPTION'].includes(el.tagName)) continue;
        if (el.closest('svg')) continue;
        seen.add(el);
        if (!visible(el)) continue;
        const fill = getComputedStyle(el).webkitTextFillColor;
        judge(el, t, fill && parse(fill) && parse(fill)[3] > 0 ? fill : getComputedStyle(el).color, 'text');
    }
    for (const el of document.querySelectorAll('input, textarea, select')) {
        if (!visible(el) || ['checkbox', 'radio', 'range', 'color', 'hidden', 'file'].includes(el.type)) continue;
        if (el.value) judge(el, el.value, getComputedStyle(el).color, 'value');
        else if (el.placeholder) judge(el, el.placeholder, getComputedStyle(el, '::placeholder').color, 'placeholder');
    }
    return items;
};
