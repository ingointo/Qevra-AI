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
    this.logger.info(category, 'Navigating to university portal...');
    
    await this.navigation.goto(page, 'https://sutech.univlms.com/signin/index?redirect=/', 60000);

    await this.retryHandler.retry(async () => {
        const usernameField = page.locator('input[name="username"], #username, input[type="text"]').first();
        await usernameField.waitFor({ state: 'visible', timeout: 15000 });
        
        this.logger.info(category, 'Entering credentials to adaptive fields...');
        await usernameField.fill(username);
        const passField = page.locator('input[type="password"]').first();
        await passField.fill(password);
        await page.keyboard.press('Enter');
        
        // Adaptive wait for dashboard or error
        await Promise.race([
            page.waitForURL('**/dashboard/**', { timeout: 30000 }),
            page.waitForSelector('.alert-danger, .error-message', { timeout: 30000 })
        ]);
        
        if (page.url().includes('dashboard')) {
            this.logger.success(category, 'Login successful.');
        } else {
            throw new Error('Login failed: Still on login page or error detected.');
        }
    }, { maxAttempts: 3, category });
  }

  public async dismissPopups(page: Page): Promise<void> {
    const category = 'POPUP';
    this.logger.info(category, 'Scanning for intrusive popups...');
    
    // Give AJAX/Modals a moment to trigger on slow networks, then poll for visibility
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    await this.retryHandler.retry(async () => {
        const dismissed = await page.evaluate(() => {
            let count = 0;
            // 1. Try semantic close buttons (Resilient to layout shifts)
            const closeSelectors = [
                'button[aria-label*="close"]',
                'button.close',
                '.modal-header .close',
                '[data-dismiss="modal"]',
                '[data-bs-dismiss="modal"]',
                'button',
                'a'
            ];
            
            for (const sel of closeSelectors) {
                const els = document.querySelectorAll(sel);
                els.forEach(el => {
                    const htmlEl = el as HTMLElement;
                    const text = (htmlEl.textContent || '').trim().toLowerCase();
                    const isVisible = htmlEl.offsetWidth > 0 || htmlEl.offsetHeight > 0;
                    
                    if (isVisible && (text === 'close' || text === 'dismiss' || htmlEl.getAttribute('aria-label')?.toLowerCase().includes('close'))) {
                        htmlEl.click();
                        count++;
                    } else if (isVisible && sel !== 'button' && sel !== 'a') {
                        // For specific modal close selectors, click directly if visible
                        htmlEl.click();
                        count++;
                    }
                });
            }

            // 2. Force remove via JS/CSS if buttons fail
            const modals = document.querySelectorAll('.modal, .modal-backdrop, .modal-dialog');
            if (modals.length > 0) {
                modals.forEach(m => (m as HTMLElement).style.setProperty('display', 'none', 'important'));
                document.body.classList.remove('modal-open');
                document.body.style.overflow = 'auto';
                count += modals.length;
            }
            return count > 0 ? `dismissed-${count}` : 'none';
        });

        this.logger.info(category, `Popup scan result: ${dismissed}`);
    }, { maxAttempts: 2, category });
  }

  public async scrapeSchedule(page: Page): Promise<ClassSchedule[]> {
    const category = 'SCRAPER';
    this.logger.info(category, 'Executing frame-aware schedule extraction...');
    
    // Ensure at least one table-like structure is present before scraping
    try {
        await page.waitForSelector('table, .schedule-container, tr', { timeout: 10000 });
    } catch (e) {
        this.logger.warn(category, 'No schedule container detected, attempting raw scrape.');
    }

    const allClasses: ClassSchedule[] = [];
    const frames = page.frames();

    for (const frame of frames) {
        try {
            const results = await frame.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('tr'));
                const list: any[] = [];
                for (const row of rows) {
                    const text = (row.textContent || '').trim();
                    if (/cancel/i.test(text) || text.length < 10) continue;

                    const timeMatch = text.match(/(\d{1,2}[.:]\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}[.:]\d{2}\s*[AP]M)/i);
                    if (!timeMatch) continue;

                    let link = '';
                    const anchors = row.querySelectorAll('a');
                    for (const a of Array.from(anchors)) {
                        const href = a.href || a.getAttribute('data-href') || '';
                        if (href && !href.startsWith('javascript') && href !== window.location.href) {
                            link = href;
                            break;
                        }
                        const onclick = a.getAttribute('onclick') || '';
                        const urlMatch = onclick.match(/https?:\/\/[^\s"']+/);
                        if (urlMatch) { link = urlMatch[0]; break; }
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

                    list.push({
                        subject: subject.substring(0, 80),
                        startTime: timeMatch[1].trim(),
                        endTime: timeMatch[2].trim(),
                        link,
                        day: 'today',
                    });
                }
                return list;
            });

            if (results && results.length > 0) {
                allClasses.push(...results);
            }
        } catch (_err) { /* silent frame fail */ }
    }

    const unique = allClasses.filter((cls, i, self) =>
        i === self.findIndex(c => c.startTime === cls.startTime && c.subject === cls.subject)
    );
    
    if (unique.length === 0) {
        this.logger.warn(category, 'No classes found in any frame.');
    } else {
        this.logger.success(category, `Scraped ${unique.length} unique class(es).`);
    }
    
    return unique;
  }
}
