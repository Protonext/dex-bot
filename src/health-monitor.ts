import { getConfig, getLogger } from './utils';
import { events } from './events';
import { HealthMonitorConfig } from './interfaces/config.interface';

const logger = getLogger();

export type EndpointCategory = 'rpc' | 'dexApi' | 'lightApi';

interface EndpointState {
  consecutiveErrors: number;
  lastError: string;
  lastErrorTime: Date | null;
  lastSuccessTime: Date | null;
}

class EndpointHealthMonitor {
  private state: Map<EndpointCategory, EndpointState> = new Map();
  private restartRequested = false;
  private config: HealthMonitorConfig = {
    errorThreshold: 15,
    enabled: true,
    cancelOrdersOnRestart: true,
  };

  initialize(): void {
    const botConfig = getConfig();
    if (botConfig.healthMonitor) {
      this.config = { ...this.config, ...botConfig.healthMonitor };
    }

    if (!this.config.enabled) {
      logger.info('[HealthMonitor] Disabled via config');
      return;
    }

    for (const category of ['rpc', 'dexApi', 'lightApi'] as EndpointCategory[]) {
      this.state.set(category, {
        consecutiveErrors: 0,
        lastError: '',
        lastErrorTime: null,
        lastSuccessTime: null,
      });
    }

    logger.info(`[HealthMonitor] Initialized — threshold: ${this.config.errorThreshold} consecutive errors`);
  }

  recordSuccess(category: EndpointCategory): void {
    if (!this.config.enabled) return;

    const s = this.state.get(category);
    if (!s) return;

    if (s.consecutiveErrors > 0) {
      logger.info(`[HealthMonitor] ${category} recovered after ${s.consecutiveErrors} consecutive errors`);
    }

    s.consecutiveErrors = 0;
    s.lastSuccessTime = new Date();
  }

  recordError(category: EndpointCategory, msg: string): void {
    if (!this.config.enabled) return;

    const s = this.state.get(category);
    if (!s) return;

    s.consecutiveErrors++;
    s.lastError = msg;
    s.lastErrorTime = new Date();

    logger.warn(`[HealthMonitor] ${category} error #${s.consecutiveErrors}/${this.config.errorThreshold}: ${msg}`);

    events.rpcError(`${category} consecutive error #${s.consecutiveErrors}`, {
      category,
      consecutiveErrors: s.consecutiveErrors,
      threshold: this.config.errorThreshold,
      error: msg,
    });

    if (s.consecutiveErrors >= this.config.errorThreshold && !this.restartRequested) {
      this.restartRequested = true;
      logger.error(`[HealthMonitor] Threshold reached for ${category} — requesting restart`);

      events.healthRestart(`Health monitor: ${category} hit ${s.consecutiveErrors} consecutive errors`, {
        category,
        consecutiveErrors: s.consecutiveErrors,
        lastError: msg,
      });

      this.sendRestartRequest(category, s);
    }
  }

  isRestartRequested(): boolean {
    return this.restartRequested;
  }

  shouldCancelOrdersOnRestart(): boolean {
    return this.config.cancelOrdersOnRestart;
  }

  private async sendRestartRequest(category: EndpointCategory, state: EndpointState): Promise<void> {
    const botConfig = getConfig();
    const dashboard = botConfig.dashboard;

    if (!dashboard?.url || !dashboard?.apiKey || !dashboard?.instanceId || dashboard?.enabled === false) {
      logger.info('[HealthMonitor] Dashboard not configured, skipping restart request POST');
      return;
    }

    try {
      const response = await fetch(`${dashboard.url}/api/instances/${dashboard.instanceId}/health-restart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${dashboard.apiKey}`,
        },
        body: JSON.stringify({
          reason: `${category} endpoint hit ${state.consecutiveErrors} consecutive errors`,
          category,
          consecutiveErrors: state.consecutiveErrors,
          lastError: state.lastError,
        }),
      });

      if (response.ok) {
        logger.info('[HealthMonitor] Restart request acknowledged by dashboard');
      } else {
        logger.warn(`[HealthMonitor] Dashboard returned ${response.status} for restart request`);
      }
    } catch (error) {
      logger.warn('[HealthMonitor] Failed to send restart request to dashboard:', error);
    }
  }
}

export const healthMonitor = new EndpointHealthMonitor();
