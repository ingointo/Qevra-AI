import Store from 'electron-store';

interface StoreSchema {
    credentials: { username: string; password: string };
    schedule: { enabled: boolean; checkIntervalMinutes: number };
    logs: string[];
}

const store = new Store<StoreSchema>({
    name: 'auto-hand-config',
    clearInvalidConfig: true,
    encryptionKey: 'auto-hand-secret-key-123',
    defaults: {
        credentials: { username: '', password: '' },
        schedule: { enabled: false, checkIntervalMinutes: 5 },
        logs: [],
    },
});

export default store;
