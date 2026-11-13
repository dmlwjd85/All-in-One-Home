/* check-sync-watch 전용 불러오기 고리: 'firebase/firestore' 를 가짜 모듈(fake-firestore.mjs)로 바꿔 끼웁니다. */
export async function resolve(specifier, context, next) {
    if (specifier === 'firebase/firestore') return { url: new URL('./fake-firestore.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
}
