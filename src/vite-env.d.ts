/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_BASE?: string;
    readonly VITE_FIREBASE_CONFIG?: string;
    readonly VITE_GOOGLE_CLIENT_ID?: string;
    readonly VITE_APP_ID?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
