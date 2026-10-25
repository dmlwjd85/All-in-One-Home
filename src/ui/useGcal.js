import { useEffect, useState } from 'react';
import { gcalReady, gcalSnapshot, subscribeGcal } from '../lib/gcalLive.js';

export function useGcal() {
    const [snap, setSnap] = useState(gcalSnapshot);
    useEffect(() => {
        let alive = true;
        gcalReady().then((row) => { if (alive) setSnap(row); });
        const stop = subscribeGcal((row) => { if (alive) setSnap(row); });
        return () => {
            alive = false;
            stop();
        };
    }, []);
    return snap;
}
