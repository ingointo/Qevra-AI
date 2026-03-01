export declare class PortalAutomator {
    private browser;
    private page;
    private onLog;
    constructor(onLog: (msg: string) => void);
    run(username: string, password: string): Promise<boolean>;
}
