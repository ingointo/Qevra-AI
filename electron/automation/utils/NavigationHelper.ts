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
        const response = await page.goto(url, {
          timeout,
          waitUntil: 'domcontentloaded',
        });

        if (response && response.status() >= 400) {
          this.logger.warn(category, `Received HTTP ${response.status()} for ${url}`);
        }
        
        // Wait for 'load' with a generous timeout but don't fail if it's just slow
        await page.waitForLoadState('load', { timeout: Math.min(timeout, 30000) }).catch(() => {
          this.logger.warn(category, `Page 'load' state delayed for ${url}, continuing based on DOM...`);
        });

        this.logger.success(category, `Successfully reached: ${url}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('net::ERR_ABORTED') || msg.includes('NS_BINDING_ABORTED')) {
          this.logger.warn(category, `Navigation aborted/redirected for ${url}.`);
          return;
        }
        throw error;
      }
    }, {
      maxAttempts: 5,
      category,
      initialDelayMs: 3000,
    });
  }

  /**
   * Adaptive wait for a specific condition or state.
   */
  public async waitForState(page: Page, predicate: () => boolean | Promise<boolean>, timeout: number = 30000): Promise<void> {
    const category = 'STATE_WAIT';
    await this.retryHandler.retry(async () => {
      await page.waitForFunction(predicate, { timeout });
    }, {
      maxAttempts: 2,
      category,
      initialDelayMs: 1000,
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
