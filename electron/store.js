import Store from 'electron-store';
var store = new Store({
    name: 'auto-hand-config',
    encryptionKey: 'auto-hand-secret-key-123', // Encrypt the file locally
    defaults: {
        credentials: {
            username: '',
            password: ''
        }
    }
});
export default store;
