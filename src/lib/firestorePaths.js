import { collection, doc } from 'firebase/firestore';
import { appId, db } from '../firebase';

/** 로그인한 계정만의 경로. artifacts/{appId}/users/{uid}/{collection}/{id} */
export function userCol(uid, name) {
    return collection(db, 'artifacts', appId, 'users', uid, name);
}

export function userDoc(uid, name, id) {
    return doc(db, 'artifacts', appId, 'users', uid, name, id);
}
