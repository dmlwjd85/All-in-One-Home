import { collection, doc } from 'firebase/firestore';
import { appId, db } from '../firebase';

/** 로그인한 계정만의 경로. artifacts/{appId}/users/{uid}/{collection}/{id} */
export function userCol(uid, name) {
    return collection(db, 'artifacts', appId, 'users', uid, name);
}

export function userDoc(uid, name, id) {
    return doc(db, 'artifacts', appId, 'users', uid, name, id);
}

/**
 * 예전 공유 경로. 읽어서 계정 공간으로 복사할 때만 씁니다.
 * 이 경로에는 쓰지 않고, 지우지도 않습니다.
 */
export function legacyCol(name) {
    return collection(db, 'artifacts', appId, 'public', 'data', name);
}
