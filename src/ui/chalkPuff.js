/** 교실풍경 쨈 버튼: 누르는 즉시 흰 분필 가루가 퍼집니다. 팝업 열림은 기다리지 않습니다. */

const LIFE_MS = 620;
const FADE_MS = 200;

function reduceMotion() {
    try {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    } catch {
        return false;
    }
}

/** 코르크 짬 단추 가운데에서 흰 가루 구름과 입자를 띄웁니다. transform/opacity만 씁니다. */
export function puffChalkDust(target) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (document.documentElement.getAttribute('data-skin') !== 'cork') return;
    const button = target?.closest?.('.foil-fab') || (target?.classList?.contains?.('foil-fab') ? target : null);
    if (!button) return;
    const disc = button.querySelector('.fab-disc') || button;
    const r = disc.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const reduced = reduceMotion();
    const host = document.createElement('span');
    host.className = reduced ? 'chalk-puff is-fade' : 'chalk-puff';
    host.setAttribute('aria-hidden', 'true');
    host.style.left = `${r.left + r.width / 2}px`;
    host.style.top = `${r.top + r.height / 2}px`;
    if (!reduced) {
        const count = 14;
        for (let i = 0; i < count; i += 1) {
            const speck = document.createElement('i');
            const ang = ((Math.PI * 2) * i) / count + (Math.random() - 0.5) * 0.5;
            const dist = 26 + Math.random() * 38;
            speck.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
            speck.style.setProperty('--dy', `${Math.sin(ang) * dist - 10}px`);
            speck.style.setProperty('--delay', `${Math.round(Math.random() * 80)}ms`);
            host.appendChild(speck);
        }
    }
    document.body.appendChild(host);
    window.setTimeout(() => host.remove(), reduced ? FADE_MS + 40 : LIFE_MS + 80);
}
