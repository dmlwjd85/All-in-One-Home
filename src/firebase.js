import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const fallbackConfig = {
    apiKey: 'AIzaSyAsih-sfnIZ_gX_1l7SAVZHCAhk3KzmiP8',
    authDomain: 'sambong-world-2026.firebaseapp.com',
    projectId: 'sambong-world-2026',
    storageBucket: 'sambong-world-2026.firebasestorage.app',
    messagingSenderId: '',
    appId: '1:728320769100:web:7510c9a77cca6b87a788e9',
    measurementId: 'G-H1RGMJHGTV',
};

export const firebaseConfig = import.meta.env.VITE_FIREBASE_CONFIG
    ? JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG)
    : fallbackConfig;

export const appId = import.meta.env.VITE_APP_ID || 'home-note-app';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
