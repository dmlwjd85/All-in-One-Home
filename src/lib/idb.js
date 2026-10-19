function openDb(name) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function requestDone(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export function createVault(name) {
    let dbPromise = null;
    const ready = () => {
        if (!dbPromise) dbPromise = openDb(name);
        return dbPromise;
    };
    return {
        async get(key) {
            const db = await ready();
            return requestDone(db.transaction('kv', 'readonly').objectStore('kv').get(key));
        },
        async set(key, value) {
            const db = await ready();
            return requestDone(db.transaction('kv', 'readwrite').objectStore('kv').put(value, key));
        },
        async remove(key) {
            const db = await ready();
            return requestDone(db.transaction('kv', 'readwrite').objectStore('kv').delete(key));
        },
    };
}
