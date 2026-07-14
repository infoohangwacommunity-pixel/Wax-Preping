import { logger } from '../middleware/logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(
    private readonly name: string,
    private readonly failThreshold = 5,
    private readonly timeoutMs = 30_000,
    private readonly halfOpenSuccessThreshold = 2
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeoutMs) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        logger.info(`[CircuitBreaker] ${this.name} → HALF_OPEN`);
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.name}`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.state = 'CLOSED';
        logger.info(`[CircuitBreaker] ${this.name} → CLOSED`);
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failThreshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      logger.warn(`[CircuitBreaker] ${this.name} → OPEN after ${this.failures} failures`);
    }
  }

  isAvailable(): boolean {
    if (this.state === 'CLOSED' || this.state === 'HALF_OPEN') return true;
    return Date.now() - this.lastFailureTime > this.timeoutMs;
  }

  getState(): CircuitState {
    return this.state;
  }
}