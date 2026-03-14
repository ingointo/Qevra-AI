import { Page } from 'playwright-core';
import { AutomationLogger } from './AutomationLogger';
import { RetryHandler } from './RetryHandler';

export class NavigationHelper {
  private logger: AutomationLogger;
  private retryHandler: RetryHandler;

  constructor(logger: AutomationLogger, retryHandler: RetryHandler) {
    this.logger = logger;
    this.retryHandler = retryHandler;
  }

  /**
   * Resiliently navigates to a URL with retries and network idle check.
   */
  public async goto(page: Page, url: string, timeout: number = 60000): Promise<void> {
    const category = 'NAVIGATION';
    this.logger.info(category, `Navigating to: ${url}`);

    await this.retryHandler.retry(async () => {
      try {
        await page.goto(url, {
          timeout,
          waitUntil: 'domcontentloaded',
        });
        
        // Wait for network to be idle or at least commit
        await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {
          this.logger.warn(category, `Load state 'load' timed out for ${url}, continuing anyway...`);
        });

        this.logger.success(category, `Successfully reached: ${url}`);
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes('net::ERR_ABORTED')) {
          this.logger.warn(category, `Navigation aborted for ${url}, likely a redirect or background load.`);
          return;
        }
        throw error;
      }
    }, {
      maxAttempts: 5,
      category,
      initialDelayMs: 2000,
    });
  }

  /**
   * Waits for a selector with optional retry logic for unstable elements.
   */
  public async waitForSelector(page: Page, selector: string, timeout: number = 30000): Promise<void> {
    const category = 'SELECTOR';
    await this.retryHandler.retry(async () => {
      await page.waitForSelector(selector, { 
        state: 'visible',
        timeout 
      });
    }, {
      maxAttempts: 3,
      category,
      initialDelayMs: 1000,
    });
  }

  /**
   * Checks if a page is partially loaded by looking for key indicators.
   */
  public async ensurePageLoaded(page: Page, indicatorSelector: string): Promise<boolean> {
    try {
      await page.waitForSelector(indicatorSelector, { timeout: 10000 });
      return true;
    } catch (error) {
      this.logger.warn('LOAD_CHECK', `Page indicator ${indicatorSelector} not found. Possible partial load.`);
      return false;
    }
  }
}
