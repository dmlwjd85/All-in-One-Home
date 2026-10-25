import { useEffect, useState } from 'react';
import { gcalReady, gcalSnapshot, subscribeGcal } from '../lib/gcalLive.js';

export function useGcal() {
    const [snap, setSnap] = useState(gcalSnapshot);
    useEffect(() => {
        let alive = true;
        gcalReady().then(() => { if (alive) setSnap(gcalSnapshot()); });
        const stop = subscribeGcal(() => { if (alive) setSnap(gcalSnapshot()); });
        return () => {
            alive = false;
            stop();
        };
    }, []);
    return snap;
}
