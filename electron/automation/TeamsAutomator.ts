import { Page } from 'playwright-core';
import { AutomationLogger } from './utils/AutomationLogger';
import { RetryHandler } from './utils/RetryHandler';
import { NavigationHelper } from './utils/NavigationHelper';

export class TeamsAutomator {
  private logger: AutomationLogger;
  private retryHandler: RetryHandler;
  private navigation: NavigationHelper;

  constructor(logger: AutomationLogger, retryHandler: RetryHandler, navigation: NavigationHelper) {
    this.logger = logger;
    this.retryHandler = retryHandler;
    this.navigation = navigation;
  }

  public async joinMeeting(page: Page, url: string, studentId: string): Promise<void> {
    const category = 'TEAMS_JOIN';
    const transformedUrl = this.transformTeamsUrl(url);
    
    // Override common blocking dialogs
    await page.addInitScript(() => {
        (window as any).confirm = () => false;
        (window as any).alert = () => { };
    });
    page.on('dialog', async (dialog) => { await dialog.dismiss(); });

    this.logger.info(category, `Initiating Teams join sequence: ${transformedUrl}`);
    await this.navigation.goto(page, transformedUrl, 90000);

    // Extra grace for initial V2 UI handshake
    await page.waitForTimeout(2000);

    this.logger.info(category, 'Implementing camera feed hijack...');
    await this.injectCameraHijack(page);

    // Step 0: Handle overlays
    await this.removeTeamsOverlay(page);

    // Step 1: Click "Continue on this browser" (Fast race)
    await this.clickContinueOnBrowser(page);

    // Step 2: Poll for Pre-Join UI (Broad selection)
    this.logger.info(category, 'Waiting for pre-join interface to initialize...');
    await page.waitForSelector([
        '[data-tid="prejoin-join-button"]',
        'input[data-tid="prejoin-display-name-input"]',
        'input[aria-label*="name" i]',
        'button:has-text("Join now")'
    ].join(','), { state: 'attached', timeout: 60000 });

    // Step 3: Turn off camera & mic (State-verified)
    await this.toggleMedia(page);

    // Step 4: Enter student ID (Action-verified)
    await this.enterStudentName(page, studentId);

    // Step 5: Final Join (Adaptive)
    await this.clickJoinNow(page);
  }

  private transformTeamsUrl(url: string): string {
    let teamsUrl = url;
    if (teamsUrl.includes('/dl/launcher/')) {
        try {
            const u = new URL(teamsUrl);
            const inner = u.searchParams.get('url');
            if (inner) teamsUrl = 'https://teams.microsoft.com' + decodeURIComponent(inner);
        } catch (_err) { /* ignore */ }
    }

    const meetingMatch = teamsUrl.match(/teams\.microsoft\.com(?:\/l|\/?\/?#\/l)?\/(meetup-join\/.+)/);
    if (meetingMatch) {
        const meetingPath = decodeURIComponent(meetingMatch[1]);
        return `https://teams.microsoft.com/v2/?meetingjoin=true#/l/${meetingPath}&anon=true`;
    }
    return teamsUrl;
  }

  private async injectCameraHijack(page: Page) {
    await page.addInitScript(() => {
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
            if (constraints && constraints.video) {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 1280;
                    canvas.height = 720;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.fillStyle = 'black';
                        ctx.fillRect(0, 0, 1280, 720);
                    }
                    const stream = (canvas as any).captureStream(10);
                    if (constraints.audio) {
                        const audioStream = await originalGetUserMedia({ audio: constraints.audio });
                        stream.addTrack(audioStream.getAudioTracks()[0]);
                    }
                    return stream;
                } catch (e) {
                    return originalGetUserMedia(constraints);
                }
            }
            return originalGetUserMedia(constraints);
        };
    });
  }

  private async removeTeamsOverlay(page: Page) {
    await page.evaluate(() => {
        const removeByText = () => {
            const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
            for (const el of all) {
                if (el.textContent?.includes('Open Microsoft Teams')) {
                    let node: HTMLElement | null = el;
                    for (let i = 0; i < 15 && node && node !== document.body; i++) {
                        const style = window.getComputedStyle(node);
                        if (['fixed', 'absolute'].includes(style.position) || parseInt(style.zIndex, 10) > 100) {
                            node.style.setProperty('display', 'none', 'important');
                            return true;
                        }
                        node = node.parentElement;
                    }
                }
            }
            return false;
        };
        
        if (!removeByText()) {
            const btns = Array.from(document.querySelectorAll('button, a')) as HTMLElement[];
            const cancelBtn = btns.find(b => b.textContent?.trim() === 'Cancel');
            if (cancelBtn) cancelBtn.click();
        }
    });
  }

  private async clickContinueOnBrowser(page: Page) {
    const category = 'TEAMS_LAUNCHER';
    const launcherSelectors = [
        'button[data-tid="joinOnWeb"]',
        'a[data-tid="joinOnWeb"]',
        'button:has-text("Continue on this browser")',
        'a:has-text("Continue on this browser")',
        'button:has-text("Join on the web instead")',
        'a:has-text("Join on the web instead")',
        'button:has-text("Continue")',
        'a:has-text("Continue")'
    ].join(', ');

    const preJoinSelectors = [
        '[data-tid="prejoin-join-button"]',
        'input[data-tid="prejoin-display-name-input"]',
        'button:has-text("Join now")'
    ].join(', ');

    await this.retryHandler.retry(async () => {
        this.logger.info(category, 'Racing: Launcher vs. Pre-join detection...');
        
        // Wait for either the launcher button OR the pre-join screen to appear
        const winner = await Promise.race([
            page.waitForSelector(launcherSelectors, { state: 'visible', timeout: 45000 }).then(() => 'launcher'),
            page.waitForSelector(preJoinSelectors, { state: 'attached', timeout: 45000 }).then(() => 'prejoin')
        ]).catch(e => {
            // Verify if we are already where we need to be despite timeout
            return page.isVisible(preJoinSelectors).then(res => res ? 'prejoin' : 'timeout');
        });

        if (winner === 'launcher') {
            this.logger.info(category, 'Launcher detected. Triggering "Continue on browser"...');
            await page.locator(launcherSelectors).first().click().catch(() => {});
            // Give a tiny moment for the redirect to trigger
            await page.waitForTimeout(1000);
        } else if (winner === 'prejoin') {
            this.logger.success(category, 'Bypassing launcher: Pre-join UI already active.');
        } else {
            throw new Error('Neither launcher nor pre-join UI detected within 45s.');
        }
    }, { maxAttempts: 2, category, initialDelayMs: 2000 });
  }

  private async toggleMedia(page: Page) {
    const category = 'TEAMS_MEDIA';
    this.logger.info(category, 'Neutralizing media streams (adaptive)...');

    for (let i = 0; i < 6; i++) {
        const result = await page.evaluate(() => {
            let actions = 0;
            // Target all potential switch/toggle inputs
            const selectors = [
                'input[data-tid="toggle-video"]', 
                'input[data-tid="toggle-mute"]',
                'input[role="switch"]',
                'button[role="switch"]'
            ];
            
            for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                for (const el of Array.from(els)) {
                    const htmlEl = el as any;
                    const isChecked = htmlEl.checked || htmlEl.getAttribute('aria-checked') === 'true';
                    const label = (htmlEl.getAttribute('aria-label') || htmlEl.getAttribute('title') || '').toLowerCase();
                    
                    if (isChecked && (label.includes('camera') || label.includes('mic') || label.includes('video') || label.includes('audio'))) {
                        htmlEl.click();
                        actions++;
                    }
                }
            }
            return actions;
        });

        if (result === 0) {
            // Check one last time for any specifically "on" states
            const stillOn = await page.evaluate(() => {
                const switches = document.querySelectorAll('input:checked, [aria-checked="true"]');
                return Array.from(switches).some(el => {
                    const txt = (el.getAttribute('aria-label') || '').toLowerCase();
                    return txt.includes('camera') || txt.includes('mic') || txt.includes('video');
                });
            });
            if (!stillOn) break;
        }
        await page.waitForTimeout(1500); // Polling interval
    }
  }

  private async enterStudentName(page: Page, studentId: string) {
    const category = 'TEAMS_NAME';
    this.logger.info(category, `Identifying identity input for: ${studentId}`);

    const nameInput = page.locator([
        'input[data-tid="prejoin-display-name-input"]',
        'input[placeholder*="Type your name"]',
        'input[aria-label*="Enter name" i]',
        'input[aria-label*="Type your name" i]',
        'input[placeholder*="name" i]',
        'input[id*="displayName"]'
    ].join(', ')).first();

    await this.retryHandler.retry(async () => {
        await nameInput.waitFor({ state: 'visible', timeout: 30000 });
        await nameInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await nameInput.fill(studentId);
        
        // Verify entry via value check
        const val = await nameInput.inputValue();
        if (val !== studentId) {
            this.logger.warn(category, 'Primary fill failed, using fallback injection.');
            await page.evaluate(({ id }) => {
                const selectors = [
                    'input[data-tid="prejoin-display-name-input"]',
                    'input[placeholder*="name" i]',
                    'input[aria-label*="name" i]',
                    'input[id*="displayName"]',
                    'input'
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel) as HTMLInputElement;
                    if (el && (el.placeholder || el.getAttribute('aria-label') || '').toLowerCase().includes('name')) {
                        el.focus();
                        el.value = id;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
                return false;
            }, { id: studentId });
        }
    }, { maxAttempts: 3, category });

    this.logger.success(category, 'Identity verified in pre-join state.');
  }

  private async clickJoinNow(page: Page) {
    const category = 'TEAMS_JOIN_NOW';
    const joinBtn = page.locator([
        'button[data-tid="prejoin-join-button"]',
        'button:has-text("Join now")',
        'button:has-text("Join")',
        '[aria-label*="Join now" i]'
    ].join(', ')).first();

    await this.retryHandler.retry(async () => {
        await joinBtn.waitFor({ state: 'visible', timeout: 30000 });
        
        // Ensure not disabled before clicking
        const isDisabled = await joinBtn.evaluate(el => 
            (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true'
        );
        
        if (isDisabled) throw new Error('Join button present but not yet interactive.');

        await joinBtn.click();
        this.logger.success(category, 'Command "Join now" executed.');
    }, { maxAttempts: 5, category, initialDelayMs: 2000 });
  }

  public async leaveMeeting(page: Page) {
    const category = 'TEAMS_LEAVE';
    try {
        const leaveBtn = page.locator([
            'button[data-tid="call-hangup"]',
            'button[aria-label*="Leave" i]',
            'button:has-text("Leave")'
        ].join(', ')).first();

        if (await leaveBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
            await leaveBtn.click();
            this.logger.success(category, 'Session terminated successfully.');
        }
    } catch (error) {
        this.logger.error(category, 'Graceful exit failed.', error);
    }
  }
}
