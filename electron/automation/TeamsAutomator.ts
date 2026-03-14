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
    let transformedUrl = this.transformTeamsUrl(url);
    
    await this.navigation.goto(page, transformedUrl);
    
    // Inject camera hijack script early
    await this.injectCameraHijack(page);

    await this.retryHandler.retry(async () => {
      this.logger.info(category, 'Handling Teams pre-join sequence...');
      
      // Step 1: Remove overlay
      await this.removeTeamsOverlay(page);

      // Step 2: Continue on browser
      await this.clickContinueOnBrowser(page);

      // Step 3: Toggle Media
      await this.toggleMedia(page);

      // Step 4: Enter Name
      await this.enterStudentName(page, studentId);

      // Step 5: Join Now
      await this.clickJoinNow(page);
      
      this.logger.success(category, 'Joined Teams meeting successfully.');
    }, {
      maxAttempts: 3,
      category,
      initialDelayMs: 5000,
    });
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
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = 'black';
              ctx.fillRect(0, 0, 1, 1);
            }
            const stream = canvas.captureStream(1);
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
      const selectors = ['div[class*="overlay"]', 'div[class*="modal"]', '.cdk-overlay-container'];
      selectors.forEach(sel => {
        const els = document.querySelectorAll(sel);
        els.forEach(el => {
          if (el.textContent?.includes('Open Microsoft Teams')) {
            (el as HTMLElement).style.display = 'none';
          }
        });
      });
      const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Cancel');
      if (cancelBtn) cancelBtn.click();
    });
  }

  private async clickContinueOnBrowser(page: Page) {
    const continueBtn = page.locator([
      'button[data-tid="joinOnWeb"]',
      'a[data-tid="joinOnWeb"]',
      ':text-is("Continue on this browser")',
    ].join(', ')).first();

    if (await continueBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await continueBtn.click();
      this.logger.info('TEAMS_JOIN', 'Clicked "Continue on this browser".');
    }
  }

  private async toggleMedia(page: Page) {
    // Repeated toggle attempts
    for (let i = 0; i < 3; i++) {
        const toggled = await page.evaluate(() => {
            let clicked = false;
            const inputs = document.querySelectorAll('input[role="switch"], input[type="checkbox"]');
            inputs.forEach(input => {
                const el = input as HTMLInputElement;
                const title = (el.getAttribute('title') || el.getAttribute('aria-label') || '').toLowerCase();
                if (el.checked && (title.includes('camera') || title.includes('mic') || title.includes('video') || title.includes('audio'))) {
                    el.click();
                    clicked = true;
                }
            });
            return clicked;
        });
        if (!toggled) break;
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  private async enterStudentName(page: Page, studentId: string) {
    const nameInput = page.locator('input[placeholder*="name" i], input[aria-label*="name" i]').first();
    if (await nameInput.isVisible({ timeout: 15000 }).catch(() => false)) {
        await nameInput.fill(studentId);
        await page.keyboard.press('Tab');
        this.logger.info('TEAMS_JOIN', 'Student name entered.');
    }
  }

  private async clickJoinNow(page: Page) {
    const joinBtn = page.locator('button:has-text("Join now"), button[data-tid="prejoin-join-button"]').first();
    await joinBtn.waitFor({ state: 'visible', timeout: 20000 });
    
    // Ensure button is enabled
    await page.waitForFunction((btn) => {
        const el = btn as HTMLButtonElement;
        return !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    }, await joinBtn.elementHandle());

    await joinBtn.click();
  }

  public async leaveMeeting(page: Page) {
    const category = 'TEAMS_LEAVE';
    try {
        const leaveBtn = page.locator('button[data-tid="call-hangup"], button[aria-label*="Leave" i], button:has-text("Leave")').first();
        if (await leaveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await leaveBtn.click();
            this.logger.success(category, 'Left the meeting.');
        } else {
            this.logger.warn(category, 'Leave button not found, navigating away.');
        }
    } catch (error) {
        this.logger.error(category, 'Error leaving meeting.', error);
    }
  }
}
