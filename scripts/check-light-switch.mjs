/** 밝게·어둡게 단추 = 교실 전등 스위치. */
import { readFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const src = (p) => readFileSync(`${root}/${p}`, 'utf8');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const app = src('src/App.jsx');
const ui = src('src/ui/LightSwitch.jsx');
const css = src('src/ui/lightSwitch.css');
check(/<LightSwitch dark=\{dark\} onToggle=\{/.test(app) && !/<IconSun \/> : <IconMoon \/>/.test(app), '윗줄 밝기 단추가 전등 스위치가 아닙니다.');
check(/교실 불 켜기\(밝게\)/.test(ui) && /교실 불 끄기\(어둡게\)/.test(ui) && /aria-pressed=\{!dark\}/.test(ui), '스위치 이름(읽기 프로그램)·눌림 상태');
check(/className=\{`icon-btn light-switch/.test(ui), '스위치도 44px 단추 크기를 지켜야 합니다.');
check(/\.light-switch\.is-off \.ls-led \{ fill: #FF9A3C;/.test(css), '꺼진 스위치 표시등이 없습니다.');
check(/prefers-reduced-motion: reduce/.test(css) && /prefers-reduced-motion: reduce/.test(ui), '움직임 줄이기 설정을 따라야 합니다.');
if (failures.length) { console.error(`전등 스위치 검사 실패 ${failures.length}건`); for (const f of failures) console.error(`- ${f}`); process.exit(1); }
console.log('전등 스위치 검사를 통과했습니다.');
