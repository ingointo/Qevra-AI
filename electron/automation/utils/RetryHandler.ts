import { AutomationLogger } from './AutomationLogger';

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  jitter?: boolean;
  category: string;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  jitter: true,
  category: 'RETRY',
};

export class RetryHandler {
  private logger: AutomationLogger;

  constructor(logger: AutomationLogger) {
    this.logger = logger;
  }

  /**
   * Executes a function with exponential backoff retries.
   */
  public async retry<T>(
    fn: () => Promise<T>,
    customOptions?: Partial<RetryOptions>
  ): Promise<T> {
    const options = { ...DEFAULT_RETRY_OPTIONS, ...customOptions };
    let lastError: any;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt === options.maxAttempts) {
          this.logger.error(options.category, `Final attempt ${attempt} failed.`, error);
          break;
        }

        const delay = this.calculateDelay(attempt, options);
        this.logger.retry(options.category, `Retrying in ${delay}ms...`, attempt, options.maxAttempts, error);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private calculateDelay(attempt: number, options: RetryOptions): number {
    let delay = options.initialDelayMs * Math.pow(options.backoffFactor, attempt - 1);
    
    if (options.jitter) {
      // Add random jitter of +/- 20%
      const jitterFactor = 0.8 + Math.random() * 0.4;
      delay = delay * jitterFactor;
    }

    return Math.min(delay, options.maxDelayMs);
  }
}
