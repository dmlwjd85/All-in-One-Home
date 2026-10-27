import { useEffect, useState } from 'react';
import { readPeriodLocal, subscribePeriodLocal } from '../lib/periodLocal.js';

/** 이 기기 시간표 설정을 읽고, 바뀌면 다시 그립니다. */
export function usePeriodLocal() {
    const [local, setLocal] = useState(() => readPeriodLocal());
    useEffect(() => subscribePeriodLocal(() => setLocal(readPeriodLocal())), []);
    return local;
}
