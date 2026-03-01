import type { Browser, BrowserContext } from 'playwright';

export interface ClassSchedule {
    subject: string;
    startTime: string;
    endTime: string;
    link: string;
    day: 'today' | 'tomorrow';
}

export class PortalAutomator {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private isRunning: boolean = true;
    private onLog: (msg: string) => void;
    private onSchedule: (schedule: ClassSchedule[]) => void;

    constructor(onLog: (msg: string) => void, onSchedule: (schedule: ClassSchedule[]) => void) {
        this.onLog = onLog;
        this.onSchedule = onSchedule;
    }

    private parseTime(timeStr: string): Date {
        const match = timeStr.trim().match(/(\d{1,2})[.:](\d{2})\s*([AP]M)/i);
        if (!match) return new Date();
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        if (match[3].toUpperCase() === 'PM' && hours < 12) hours += 12;
        if (match[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
        const d = new Date();
        d.setHours(hours, minutes, 0, 0);
        return d;
    }

    private async dismissReferralPopup(page: import('playwright').Page) {
        this.onLog('Checking for referral popup...');
        // Wait for popup to appear after page loads
        await page.waitForTimeout(3000);
        this.onLog('Checking for referral popup...');

        try {
            // Strategy 1: Use Bootstrap jQuery to programmatically hide the modal
            const dismissed = await page.evaluate(() => {
                try {
                    // Bootstrap 3/4 jQuery API
                    const $ = (window as { jQuery?: CallableFunction; $?: CallableFunction }).jQuery
                        || (window as { jQuery?: CallableFunction; $?: CallableFunction }).$;
                    if ($) {
                        ($ as CallableFunction)('.modal').modal('hide');
                        ($ as CallableFunction)('body').removeClass('modal-open');
                        ($ as CallableFunction)('.modal-backdrop').remove();
                        return 'jquery';
                    }
                } catch (_err) { /* fallthrough */ }

                // Bootstrap 5 native API
                try {
                    const modals = Array.from(document.querySelectorAll('.modal.show, .modal[style*="display: block"]'));
                    for (const m of modals) {
                        const bsModal = (window as { bootstrap?: { Modal?: { getInstance: (el: Element) => { hide: () => void } | null } } })
                            .bootstrap?.Modal?.getInstance(m);
                        if (bsModal) bsModal.hide();
                    }
                } catch (_err) { /* fallthrough */ }

                // Direct DOM: Click the × button (data-dismiss="modal" is Bootstrap's close trigger)
                const dismissBtn = document.querySelector('[data-dismiss="modal"], [data-bs-dismiss="modal"]') as HTMLElement;
                if (dismissBtn) { dismissBtn.click(); return 'data-dismiss'; }

                // Direct DOM: Find Close button by text
                const allBtns = Array.from(document.querySelectorAll('button, a'));
                const closeBtn = allBtns.find(b => (b.textContent || '').trim().toLowerCase() === 'close');
                if (closeBtn) { (closeBtn as HTMLElement).click(); return 'close-text'; }

                return 'none';
            });
            this.onLog(`Popup strategy result: ${dismissed}`);
        } catch (e) {
            // ignore
        }

        await page.waitForTimeout(500);

        // Strategy 2: Click the × icon in the top-right of the modal (approximate position)
        // Based on screenshot, the × is near the right edge of the popup at ~y=115
        try {
            await page.mouse.click(703, 117);
            await page.waitForTimeout(400);
        } catch (e) { /* ignore */ }

        // Strategy 3: Click well outside the popup on the dark left edge
        try {
            await page.mouse.click(30, 400);
            await page.waitForTimeout(400);
        } catch (e) { /* ignore */ }

        // Strategy 4 (nuclear): Force-remove modal elements from DOM directly
        try {
            await page.evaluate(() => {
                ['.modal', '.modal-backdrop', '.modal-dialog'].forEach(sel => {
                    Array.from(document.querySelectorAll(sel)).forEach(el => {
                        (el as HTMLElement).style.display = 'none';
                    });
                });
                document.body.style.overflow = 'auto';
                document.body.classList.remove('modal-open');
            });
            this.onLog('Popup forcibly removed from DOM.');
        } catch (e) { /* ignore */ }
    }

    private async scrapeSchedule(page: import('playwright').Page): Promise<ClassSchedule[]> {
        // Scroll down to load the schedule table
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(2000);

        // Debug: dump how many rows and links exist so we can tune the scraper
        const debugInfo = await page.evaluate(() => {
            const allRows = document.querySelectorAll('tr');
            const allLinks = document.querySelectorAll('a');
            // Find any text containing AM/PM timing pattern
            const bodyText = document.body.innerText;
            const timeMatches = bodyText.match(/(\d{1,2}[.:.]\d{2}\s*[AP]M)/gi) || [];
            return {
                rowCount: allRows.length,
                linkCount: allLinks.length,
                timesFound: timeMatches.slice(0, 10),
                // Sample first table's HTML
                firstTable: document.querySelector('table')?.innerHTML?.substring(0, 500) || 'NO TABLE FOUND',
            };
        });
        this.onLog(`Debug: ${debugInfo.rowCount} rows, ${debugInfo.linkCount} links, times: ${debugInfo.timesFound.join(', ')}`);

        const allClasses: ClassSchedule[] = [];
        const frames = page.frames();

        for (const frame of frames) {
            try {
                const results = await frame.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('tr'));
                    const classes: { subject: string; startTime: string; endTime: string; link: string; day: 'today' | 'tomorrow' }[] = [];

                    for (const row of rows) {
                        const text = row.textContent || '';
                        // Skip cancelled classes
                        if (/cancel/i.test(text)) continue;

                        // Match time range like "10.45 AM-11.45 AM" or "10:45 AM - 11:45 AM"
                        const timeMatch = text.match(
                            /(\d{1,2}[.:]\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}[.:]\d{2}\s*[AP]M)/i
                        );
                        if (!timeMatch) continue;

                        // Get any link in the row (href OR data-href OR onclick URL)
                        let link = '';
                        const anchors = row.querySelectorAll('a');
                        for (const a of Array.from(anchors)) {
                            const href = a.href || a.getAttribute('data-href') || '';
                            if (href && !href.startsWith('javascript') && href !== window.location.href) {
                                link = href;
                                break;
                            }
                            // Check onclick for URL
                            const onclick = a.getAttribute('onclick') || '';
                            const urlMatch = onclick.match(/https?:\/\/[^\s"']+/);
                            if (urlMatch) { link = urlMatch[0]; break; }
                        }

                        // Also check if any TD contains a direct URL
                        if (!link) {
                            const html = row.innerHTML;
                            const urlMatch = html.match(/https?:\/\/[^\s"'<]+/);
                            if (urlMatch) link = urlMatch[0];
                        }

                        if (!link) continue;

                        // Get subject from longest <td> text
                        const cells = Array.from(row.querySelectorAll('td'));
                        let subject = 'Class';
                        for (const cell of cells) {
                            const t = (cell.textContent || '').trim().replace(/\s+/g, ' ');
                            if (t.length > subject.length && !/[AP]M/.test(t) && !/^\d+$/.test(t)) {
                                subject = t;
                            }
                        }

                        classes.push({
                            subject: subject.substring(0, 80),
                            startTime: timeMatch[1].trim(),
                            endTime: timeMatch[2].trim(),
                            link,
                            day: 'today' as const,
                        });
                    }
                    return classes;
                });

                if (results.length > 0) {
                    this.onLog(`Found ${results.length} classes in frame: ${frame.url().substring(0, 60)}`);
                    allClasses.push(...results);
                }
            } catch (_err) {
                // cross-origin frame — ignore
            }
        }

        // Deduplicate by startTime + subject
        return allClasses.filter((cls, i, self) =>
            i === self.findIndex(c => c.startTime === cls.startTime && c.subject === cls.subject)
        );
    }

    async run(username: string, password: string): Promise<boolean> {
        this.isRunning = true;
        try {
            this.onLog('Launching automation browser...');
            const { chromium } = await import('playwright');

            this.browser = await chromium.launch({
                headless: false,
                args: [
                    '--use-fake-ui-for-media-stream',
                    '--use-fake-device-for-media-stream',
                    '--disable-notifications',
                    // Prevent the "Open Microsoft Teams?" OS-level protocol dialog
                    '--disable-features=ExternalProtocolDialog',
                    '--no-default-browser-check',
                    '--no-first-run',
                    '--disable-features=msTeamsDesktopAppIntegration'
                ]
            });

            this.context = await this.browser.newContext({
                permissions: ['camera', 'microphone'],
                viewport: { width: 1280, height: 800 },
            });

            const page = await this.context.newPage();

            // ─── LOGIN ───────────────────────────────────────────────────────────
            this.onLog('Navigating to university portal...');
            await page.goto('https://sutech.univlms.com/signin/index?redirect=/', {
                waitUntil: 'domcontentloaded',
            });

            // Only fill login if the username field is present
            const usernameField = await page.locator('input[name="username"], #username, input[type="text"]').first();
            if (await usernameField.isVisible({ timeout: 4000 }).catch(() => false)) {
                this.onLog('Entering credentials...');
                await usernameField.fill(username);
                const passField = await page.locator('input[type="password"]').first();
                await passField.fill(password);
                await page.keyboard.press('Enter');
                this.onLog('Submitted login, waiting for dashboard...');
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
            }

            await page.waitForTimeout(4000);
            this.onLog(`Logged in. Current URL: ${page.url()}`);

            // ─── MAIN AUTOMATION LOOP ────────────────────────────────────────────
            while (this.isRunning) {
                // Make sure we are on the dashboard
                const currentUrl = page.url();
                this.onLog(`Current page: ${currentUrl}`);
                if (!currentUrl.includes('/dashboard')) {
                    this.onLog('Navigating to dashboard...');
                    await page.goto('https://sutech.univlms.com/dashboard/index', { waitUntil: 'domcontentloaded' });
                    await page.waitForTimeout(3000);
                }

                // 1. Dismiss referral popup
                this.onLog('Step 1: Dismissing popup...');
                await this.dismissReferralPopup(page);
                this.onLog('Step 1 done.');

                // 2. Scrape schedule
                this.onLog('Step 2: Reading class schedule from dashboard...');
                const schedule = await this.scrapeSchedule(page);
                this.onLog(`Step 2 done: ${schedule.length} class(es) found.`);
                this.onSchedule(schedule);

                if (schedule.length === 0) {
                    this.onLog('No classes on dashboard. Browser stays open — you can view the portal.');
                    // Don't break — keep browser alive so user can see the page
                    await page.waitForTimeout(60_000);
                    continue;
                }

                // 3. Decide what to join
                const now = new Date();
                let activeClass: ClassSchedule | null = null;
                let nextClass: ClassSchedule | null = null;

                for (const cls of schedule) {
                    const start = this.parseTime(cls.startTime);
                    const end = this.parseTime(cls.endTime);
                    const earlyJoin = new Date(start.getTime() - 10 * 60_000);

                    if (now >= earlyJoin && now < end) {
                        activeClass = cls;
                        break;
                    }
                    if (now < earlyJoin && !nextClass) {
                        nextClass = cls;
                    }
                }

                if (activeClass) {
                    await this.joinClass(page, activeClass, username);
                    this.onLog('Class finished. Looping back to dashboard...');
                } else if (nextClass) {
                    // ⚡ TEST_MODE: set to true to skip wait and join immediately for testing
                    const TEST_MODE = false;

                    const start = this.parseTime(nextClass.startTime);
                    const joinAt = new Date(start.getTime() - 10 * 60_000);
                    const waitMs = joinAt.getTime() - Date.now();

                    if (TEST_MODE) {
                        this.onLog(`[TEST] Joining "${nextClass.subject}" immediately (skipping wait)...`);
                        await this.joinClass(page, nextClass, username);
                    } else if (waitMs > 0 && waitMs < 4 * 60 * 60_000) {
                        this.onLog(`Next: "${nextClass.subject}" at ${nextClass.startTime}. Waiting ${Math.round(waitMs / 60_000)}m…`);
                        let remaining = waitMs;
                        while (remaining > 0 && this.isRunning) {
                            const tick = Math.min(30_000, remaining);
                            await page.waitForTimeout(tick);
                            remaining -= tick;
                            if (remaining > 30_000) this.onLog(`${Math.round(remaining / 60_000)}m until next class…`);
                        }
                    } else {
                        this.onLog(`Next class is too far away. All done for now.`);
                        break;
                    }
                } else {
                    this.onLog('All classes for today complete! You can close the browser.');
                    break;
                }
            }

            this.onLog('Automation stopped by user.');
            return true;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.onLog(`[ERROR] ${msg}`);
            this.onLog('[INFO] Browser left open for inspection. Press Stop to close.');
            return false;
        }
    }

    private async joinClass(page: import('playwright').Page, cls: ClassSchedule, studentId: string) {
        this.onLog(`Joining: "${cls.subject}" (${cls.startTime} – ${cls.endTime})`);

        // ── Transform URL to Teams v2 web format ──────────────────────────────
        // The portal gives us /l/meetup-join/ links which trigger the "Open Microsoft Teams?" dialog.
        // Navigating directly to /v2/?meetingjoin=true skips the dialog completely.
        let teamsUrl = cls.link;

        // Step 1: Unwrap launcher URLs (portal sometimes wraps the link)
        if (teamsUrl.includes('/dl/launcher/')) {
            try {
                const u = new URL(teamsUrl);
                const inner = u.searchParams.get('url');
                if (inner) teamsUrl = 'https://teams.microsoft.com' + decodeURIComponent(inner);
            } catch (_err) { /* ignore malformed URL */ }
        }

        // Step 2: Convert /l/meetup-join/ or /_#/meetup-join/ → /v2/?meetingjoin=true
        // This is the URL that appears AFTER you click "Continue on this browser" — no dialog!
        const meetingMatch = teamsUrl.match(/teams\.microsoft\.com(?:\/l|\/?\/?#\/l)?\/(meetup-join\/.+)/);
        if (meetingMatch) {
            const meetingPath = decodeURIComponent(meetingMatch[1]);
            teamsUrl = `https://teams.microsoft.com/v2/?meetingjoin=true#/l/${meetingPath}&anon=true`;
            this.onLog(`Transformed to v2 URL (no dialog): ${teamsUrl.substring(0, 80)}...`);
        }

        const isTeams = teamsUrl.includes('teams.microsoft') || teamsUrl.includes('teams.live');

        // ── Override confirm/alert BEFORE navigation ──────────────────────────
        await page.addInitScript(() => {
            window.confirm = () => false;
            window.alert = () => { };
        });
        page.on('dialog', async (dialog) => { await dialog.dismiss(); });

        this.onLog(`Opening Teams URL...`);
        await page.goto(teamsUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
        await page.waitForTimeout(3000); // wait for Teams to load and possibly redirect

        if (isTeams) {
            // ── Step 0: Force-remove the "Open Microsoft Teams?" overlay ─────────
            // This overlay is an HTML element Teams renders over the page.
            // We forcibly hide it via JS rather than clicking Cancel, which is unreliable.
            this.onLog('Removing "Open Microsoft Teams?" overlay...');
            const removed = await page.evaluate(() => {
                let found = false;
                // Walk through all elements — find any containing "Open Microsoft Teams" text
                const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
                for (const el of all) {
                    // Only look at leaf/near-leaf nodes with the exact text
                    if (el.childElementCount < 4 && el.textContent?.includes('Open Microsoft Teams')) {
                        // Walk up to find the containing modal/overlay (fixed positioned or high z-index)
                        let node: HTMLElement | null = el;
                        for (let i = 0; i < 12 && node && node !== document.body; i++) {
                            const style = window.getComputedStyle(node);
                            if (style.position === 'fixed' || style.position === 'absolute' || parseInt(style.zIndex) > 10) {
                                node.style.setProperty('display', 'none', 'important');
                                found = true;
                                break;
                            }
                            node = node.parentElement;
                        }
                        if (found) break;
                    }
                }
                // Also try clicking Cancel directly as a backup
                if (!found) {
                    const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
                    const cancelBtn = btns.find(b => b.textContent?.trim() === 'Cancel');
                    if (cancelBtn) { cancelBtn.click(); found = true; }
                }
                return found;
            });
            this.onLog(removed ? 'Overlay removed.' : 'No overlay found — page is clean.');
            await page.waitForTimeout(800);

            // ── Step 1: Click "Continue on this browser" ──────────────────────
            this.onLog('Waiting for Teams pre-join screen...');
            const continueBtn = page.locator([
                'button[data-tid="joinOnWeb"]',
                'a[data-tid="joinOnWeb"]',
                ':text-is("Continue on this browser")',
                ':text-is("Continue without audio")',
            ].join(', ')).first();

            const visible = await continueBtn.isVisible({ timeout: 15_000 }).catch(() => false);
            if (visible) {
                await continueBtn.click();
                this.onLog('Clicked "Continue on this browser".');
            } else {
                this.onLog('Continue button not found — may already be on pre-join screen.');
            }


            // ── Step 2: Wait for pre-join UI ──────────────────────────────────
            await page.waitForTimeout(5000);

            // ── Step 3: Turn off camera & mic ─────────────────────────────────
            this.onLog('Turning off camera and microphone...');
            // Click camera/mic toggle buttons that are currently ON
            await page.evaluate(() => {
                // Targets: aria switches, checkboxes, and Teams-specific video/audio buttons
                const selectors = [
                    '[data-tid="toggle-video"]',
                    '[data-tid="toggle-mute"]',
                    '[aria-label*="camera" i]',
                    '[aria-label*="microphone" i]',
                    '[aria-label*="video" i]',
                    '[role="switch"][aria-checked="true"]',
                ];
                for (const sel of selectors) {
                    document.querySelectorAll(sel).forEach(el => {
                        const checked = el.getAttribute('aria-checked') || el.getAttribute('aria-pressed') || '';
                        // Only click if currently ON (checked=true or pressed=true)
                        if (checked !== 'false' && el instanceof HTMLElement) el.click();
                    });
                }
            });
            await page.waitForTimeout(1000);

            // ── Step 4: Enter student ID ──────────────────────────────────────
            // Wait for Teams to redirect to the light-meetings/launch pre-join page
            try {
                await page.waitForURL('**/light-meetings/**', { timeout: 10_000 });
                this.onLog('Pre-join screen loaded (light-meetings).');
            } catch (_) {
                this.onLog('Still on same page — proceeding.');
            }

            // Use Playwright fill() — works with React inputs (not raw DOM .value)
            const nameInput = page.locator([
                'input[placeholder*="name" i]',
                'input[placeholder*="Type your name" i]',
                'input[data-tid="prejoin-display-name-input"]',
                'input[type="text"]',
            ].join(', ')).first();

            const nameVisible = await nameInput.isVisible({ timeout: 6000 }).catch(() => false);
            if (nameVisible) {
                this.onLog(`Entering student ID: ${studentId}`);
                await nameInput.click();
                await nameInput.selectText().catch(() => { });
                await nameInput.fill(studentId);
                await page.waitForTimeout(600);
                this.onLog('Student ID entered successfully.');
            } else {
                this.onLog('Name input not found — may already be in meeting.');
            }

            // ── Step 5: Click "Join now" ──────────────────────────────────────
            const joinBtn = page.locator([
                'button[data-tid="prejoin-join-button"]',
                ':text-is("Join now")',
                ':text-is("Join")',
                'button[aria-label*="Join" i]',
            ].join(', ')).first();

            if (await joinBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
                await joinBtn.click();
                this.onLog('Clicked "Join now" — attending class!');
            } else {
                this.onLog('Join button not found. May already be in the meeting.');
            }
        } else {
            this.onLog('Non-Teams link opened. Attending...');
        }

        // ─── Wait until end time ──────────────────────────────────────────────
        const endTime = this.parseTime(cls.endTime);
        let msLeft = endTime.getTime() - Date.now();

        while (msLeft > 0 && this.isRunning) {
            const mins = Math.floor(msLeft / 60_000);
            const secs = Math.floor((msLeft / 1000) % 60);
            this.onLog(`Attending "${cls.subject}"... ${mins}m ${secs}s until ${cls.endTime}`);
            const tick = Math.min(60_000, msLeft);
            await page.waitForTimeout(tick);
            msLeft = endTime.getTime() - Date.now();
        }

        // ─── Leave the meeting ────────────────────────────────────────────────
        if (this.isRunning) {
            this.onLog(`Class ended at ${cls.endTime}. Leaving meeting...`);
            if (isTeams) {
                const leaveBtn = await page.locator(
                    'button[data-tid="call-hangup"], #hangup-button, button[aria-label*="Leave" i], button:has-text("Leave")'
                ).first();
                if (await leaveBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
                    await leaveBtn.click();
                    this.onLog('Left the Teams meeting.');
                } else {
                    this.onLog('Leave button not found — navigating away.');
                }
            }
            await page.waitForTimeout(2000);
        }
    }

    public stop() {
        this.isRunning = false;
        if (this.browser) this.browser.close().catch(() => { });
    }
}
