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
check(/교실 불 켜기\(밝게\)/.test(ui) && /교실 불 끄기\(어둡게\)/.test(ui) && !/aria-pressed/.test(ui), '스위치 이름(읽기 프로그램)은 할 일(켜기·끄기)로 말하고, 눌림 표시(aria-pressed)는 두지 않습니다(이름과 겹쳐 헷갈리고, 다른 화면 검사가 첫 눌림 단추로 잘못 잡습니다).');
check(/className=\{`icon-btn light-switch\$\{dark \? ' ls-off' : ' ls-on'\}`\}/.test(ui) && !/' is-on'|' is-off'/.test(ui), '스위치 상태 이름은 ls-on·ls-off(설정 단추의 is-on 강조색과 겹치지 않게)');
check(/<span className="ls-word" aria-hidden="true">\{dark \? 'OFF' : 'ON'\}<\/span>/.test(ui), '스위치 안 ON/OFF 글자가 없습니다.');
check(/\.ls-led \{ fill: #FF9A3C;/.test(css) && /\{dark && <circle className="ls-led"/.test(ui), '꺼진 스위치 표시등이 없습니다.');
check(/width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"/.test(ui) && !/#FBF8F1|#E2DCD0/.test(css), '스위치 그림이 옆 단추(찾기·설정)와 같은 선 그림·글자색이 아닙니다.');
check(/prefers-reduced-motion: reduce/.test(css) && /prefers-reduced-motion: reduce/.test(ui), '움직임 줄이기 설정을 따라야 합니다.');
if (failures.length) { console.error(`전등 스위치 검사 실패 ${failures.length}건`); for (const f of failures) console.error(`- ${f}`); process.exit(1); }
console.log('전등 스위치 검사를 통과했습니다.');
