export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  RETRY = 'RETRY',
  SUCCESS = 'SUCCESS',
}

export type LogCallback = (message: string) => void;

export class AutomationLogger {
  private onLog: LogCallback;

  constructor(onLog: LogCallback) {
    this.onLog = onLog;
  }

  public log(level: LogLevel, category: string, message: string, detail?: unknown) {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] [${level}] [${category}] ${message}`;
    
    this.onLog(formattedMessage);
    
    if (detail) {
      if (detail instanceof Error) {
        this.onLog(`[${category} DETAIL] Error: ${detail.message}\n${detail.stack}`);
      } else {
        this.onLog(`[${category} DETAIL] ${JSON.stringify(detail)}`);
      }
    }

    // Also log to console for development visibility
    if (level === LogLevel.ERROR) {
      console.error(formattedMessage, detail || '');
    } else if (level === LogLevel.WARN || level === LogLevel.RETRY) {
      console.warn(formattedMessage, detail || '');
    } else {
      console.log(formattedMessage, detail || '');
    }
  }

  public info(category: string, message: string, detail?: unknown) {
    this.log(LogLevel.INFO, category, message, detail);
  }

  public warn(category: string, message: string, detail?: unknown) {
    this.log(LogLevel.WARN, category, message, detail);
  }

  public error(category: string, message: string, detail?: unknown) {
    this.log(LogLevel.ERROR, category, message, detail);
  }

  public retry(category: string, message: string, attempt: number, maxAttempts: number, error?: unknown) {
    this.log(LogLevel.RETRY, category, `Attempt ${attempt}/${maxAttempts}: ${message}`, error);
  }

  public success(category: string, message: string) {
    this.log(LogLevel.SUCCESS, category, message);
  }
}
