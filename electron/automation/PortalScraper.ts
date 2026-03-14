import { Page } from 'playwright-core';
import { ClassSchedule } from './types';
import { AutomationLogger } from './utils/AutomationLogger';
import { RetryHandler } from './utils/RetryHandler';
import { NavigationHelper } from './utils/NavigationHelper';

export class PortalScraper {
  private logger: AutomationLogger;
  private retryHandler: RetryHandler;
  private navigation: NavigationHelper;

  constructor(logger: AutomationLogger, retryHandler: RetryHandler, navigation: NavigationHelper) {
    this.logger = logger;
    this.retryHandler = retryHandler;
    this.navigation = navigation;
  }

  public async login(page: Page, username: string, password: string): Promise<void> {
    const category = 'LOGIN';
    await this.navigation.goto(page, 'https://sutech.univlms.com/signin/index?redirect=/');

    await this.retryHandler.retry(async () => {
      this.logger.info(category, 'Attempting login...');
      
      const usernameField = page.locator('input[name="username"], #username, input[type="text"]').first();
      await usernameField.waitFor({ state: 'visible', timeout: 10000 });
      await usernameField.fill(username);

      const passField = page.locator('input[type="password"]').first();
      await passField.fill(password);
      
      await page.keyboard.press('Enter');

      // Wait for navigation or dashboard-specific element
      await Promise.race([
        page.waitForURL('**/dashboard/**', { timeout: 20000 }),
        page.waitForSelector('.dashboard-title, #dashboard', { timeout: 20000 })
      ]);
      
      this.logger.success(category, 'Login successful.');
    }, {
      maxAttempts: 3,
      category,
    });
  }

  public async dismissPopups(page: Page): Promise<void> {
    const category = 'POPUP';
    this.logger.info(category, 'Checking for popups...');
    
    await this.retryHandler.retry(async () => {
      const dismissed = await page.evaluate(() => {
        try {
          const win = window as unknown as { 
            jQuery?: (selector: string) => { modal: (cmd: string) => void };
            $: (selector: string) => { modal: (cmd: string) => void };
            bootstrap?: { Modal?: { getInstance: (el: Element) => { hide: () => void } | null } }
          };

          // Bootstrap 3/4 jQuery API
          const $ = win.jQuery || win.$;
          if ($) {
            $('.modal').modal('hide');
            const body = document.body;
            body.classList.remove('modal-open');
            const backdrops = document.querySelectorAll('.modal-backdrop');
            backdrops.forEach(b => b.remove());
            return 'jquery';
          }

          // Bootstrap 5 native API
          const modals = Array.from(document.querySelectorAll('.modal.show, .modal[style*="display: block"]'));
          for (const m of modals) {
            const bsModal = win.bootstrap?.Modal?.getInstance(m);
            if (bsModal) bsModal.hide();
          }

          // Direct DOM: Click the × button
          const dismissBtn = document.querySelector('[data-dismiss="modal"], [data-bs-dismiss="modal"]') as HTMLElement;
          if (dismissBtn) { dismissBtn.click(); return 'data-dismiss'; }

          // Force-remove modal elements from DOM directly
          ['.modal', '.modal-backdrop', '.modal-dialog'].forEach(sel => {
            Array.from(document.querySelectorAll(sel)).forEach(el => {
              (el as HTMLElement).style.display = 'none';
            });
          });
          document.body.style.overflow = 'auto';
          document.body.classList.remove('modal-open');
          
          return 'dom-force';
        } catch (e) {
          return 'error';
        }
      });
      this.logger.info(category, `Popup dismissal strategy result: ${dismissed}`);
    }, {
      maxAttempts: 2,
      category,
    });
  }

  public async scrapeSchedule(page: Page): Promise<ClassSchedule[]> {
    const category = 'SCRAPER';
    this.logger.info(category, 'Starting schedule detection loop...');

    return await this.retryHandler.retry(async () => {
      // Small scroll to trigger lazy loading if any
      await page.mouse.wheel(0, 500);
      await new Promise(resolve => setTimeout(resolve, 2000));

      const classes = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const results: ClassSchedule[] = [];

        for (const row of rows) {
          const text = row.textContent || '';
          if (/cancel/i.test(text)) continue;

          const timeMatch = text.match(
            /(\d{1,2}[.:]\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}[.:]\d{2}\s*[AP]M)/i
          );
          if (!timeMatch) continue;

          let link = '';
          const anchors = row.querySelectorAll('a');
          for (const a of Array.from(anchors)) {
            const href = a.href || a.getAttribute('data-href') || '';
            if (href && !href.startsWith('javascript') && href !== window.location.href) {
              link = href;
              break;
            }
          }

          if (!link) {
            const urlMatch = row.innerHTML.match(/https?:\/\/[^\s"'<]+/);
            if (urlMatch) link = urlMatch[0];
          }

          if (!link) continue;

          const cells = Array.from(row.querySelectorAll('td'));
          let subject = 'Class';
          for (const cell of cells) {
            const t = (cell.textContent || '').trim().replace(/\s+/g, ' ');
            if (t.length > subject.length && !/[AP]M/.test(t) && !/^\d+$/.test(t)) {
              subject = t;
            }
          }

          results.push({
            subject: subject.substring(0, 80),
            startTime: timeMatch[1].trim(),
            endTime: timeMatch[2].trim(),
            link,
            day: 'today',
          });
        }
        return results;
      });

      if (classes.length === 0) {
        throw new Error('No classes found in current view. Retrying detection...');
      }

      this.logger.success(category, `Detected ${classes.length} classes.`);
      return classes;
    }, {
      maxAttempts: 3,
      category,
      initialDelayMs: 3000,
    });
  }
}
