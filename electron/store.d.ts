import Store from 'electron-store';
declare const store: Store<{
    credentials: {
        username: string;
        password: string;
    };
}>;
export default store;
