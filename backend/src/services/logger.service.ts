export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogContext {
  schoolId?: string | null;
  tripId?: string | null;
  busId?: string | null;
  driverId?: string | null;
  userId?: string | null;
  [key: string]: any;
}

class Logger {
  private level: LogLevel = LogLevel.INFO;

  constructor() {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel === 'DEBUG') this.level = LogLevel.DEBUG;
    if (envLevel === 'WARN') this.level = LogLevel.WARN;
    if (envLevel === 'ERROR') this.level = LogLevel.ERROR;
  }

  private redact(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    const sensitiveKeys = ['password', 'token', 'secret', 'authorization', 'apiKey'];
    const cleaned: Record<string, any> = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
        cleaned[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        cleaned[key] = this.redact(value);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  private formatMessage(
    levelName: string,
    message: string,
    context?: LogContext
  ): string {
    const timestamp = new Date().toISOString();
    const payload = {
      timestamp,
      level: levelName,
      message,
      ...(context ? { context: this.redact(context) } : {}),
    };
    return JSON.stringify(payload);
  }

  debug(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(this.formatMessage('DEBUG', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.INFO) {
      console.log(this.formatMessage('INFO', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN', message, context));
    }
  }

  error(message: string, error?: Error | any, context?: LogContext): void {
    if (this.level <= LogLevel.ERROR) {
      const errContext = {
        ...context,
        ...(error instanceof Error
          ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
          : { error }),
      };
      console.error(this.formatMessage('ERROR', message, errContext));
    }
  }
}

export const logger = new Logger();

