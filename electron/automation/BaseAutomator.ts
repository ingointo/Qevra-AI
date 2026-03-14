import { Browser, BrowserContext, chromium } from 'playwright-core';
import { AutomationLogger } from './utils/AutomationLogger';
import { RetryHandler } from './utils/RetryHandler';
import { NavigationHelper } from './utils/NavigationHelper';

export class BaseAutomator {
  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;
  protected logger: AutomationLogger;
  protected retryHandler: RetryHandler;
  protected navigation: NavigationHelper;

  constructor(onLog: (msg: string) => void) {
    this.logger = new AutomationLogger(onLog);
    this.retryHandler = new RetryHandler(this.logger);
    this.navigation = new NavigationHelper(this.logger, this.retryHandler);
  }

  protected async launchBrowser(): Promise<void> {
    const category = 'BROWSER';
    this.logger.info(category, 'Launching optimized automation browser...');

    const launchOptions = {
      headless: false,
      args: [
        // Core functionality
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--disable-notifications',
        '--disable-features=ExternalProtocolDialog',
        '--no-default-browser-check',
        '--no-first-run',
        '--disable-features=msTeamsDesktopAppIntegration',
        
        // Low bandwidth / Network stability optimizations
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-extensions',
        '--disable-features=AudioServiceOutOfProcess',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-notifications',
        '--disable-offer-store-unmasked-wallet-cards',
        '--disable-popup-blocking',
        '--disable-print-preview',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-setuid-sandbox',
        '--disable-speech-api',
        '--disable-sync',
        '--hide-scrollbars',
        '--ignore-gpu-blacklist',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-pings',
        '--no-sandbox',
        '--no-zygote',
        '--password-store=basic',
        '--use-gl=swiftshader',
        '--use-mock-keychain',
      ]
    };

    // Simplified launch logic
    await this.retryHandler.retry(async () => {
      try {
        this.browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
        this.logger.success(category, 'Launched Google Chrome successfully.');
      } catch (error) {
        this.logger.warn(category, 'Chrome not found. Attempting to launch Microsoft Edge...');
        this.browser = await chromium.launch({ ...launchOptions, channel: 'msedge' });
        this.logger.success(category, 'Launched Microsoft Edge successfully.');
      }
    }, {
      maxAttempts: 2,
      category,
    });

    if (!this.browser) {
      throw new Error('Failed to launch browser after multiple attempts.');
    }

    this.context = await this.browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 800 },
      // Reduce image loading quality or block some if possible (not easily in playwright without proxy)
    });
  }

  public async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
        this.logger.info('BROWSER', 'Browser closed.');
      } catch (error) {
        this.logger.error('BROWSER', 'Error closing browser.', error);
      } finally {
        this.browser = null;
        this.context = null;
      }
    }
  }
}
