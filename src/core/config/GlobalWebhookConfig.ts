import { ConfigService } from '@nestjs/config';
import { WAHAEvents } from '@waha/structures/enums.dto';
import {
  CustomHeader,
  HmacConfiguration,
  RetriesConfiguration,
  WebhookConfig,
} from '@waha/structures/webhooks.config.dto';
import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';

enum Env {
  WHATSAPP_HOOK_URL = 'WHATSAPP_HOOK_URL',
  WHATSAPP_HOOK_EVENTS = 'WHATSAPP_HOOK_EVENTS',
  WHATSAPP_HOOK_RETRIES_POLICY = 'WHATSAPP_HOOK_RETRIES_POLICY',
  WHATSAPP_HOOK_RETRIES_DELAY_SECONDS = 'WHATSAPP_HOOK_RETRIES_DELAY_SECONDS',
  WHATSAPP_HOOK_RETRIES_ATTEMPTS = 'WHATSAPP_HOOK_RETRIES_ATTEMPTS',
  WHATSAPP_HOOK_HMAC_KEY = 'WHATSAPP_HOOK_HMAC_KEY',
  WHATSAPP_HOOK_CUSTOM_HEADERS = 'WHATSAPP_HOOK_CUSTOM_HEADERS',
}

/**
 * Helper class to build per-session env variable names
 */
class SessionEnv {
  private static SESSION_SEPARATOR = '__';

  static forSession(envName: Env, sessionName: string): string {
    return `${envName}${this.SESSION_SEPARATOR}${sessionName.toUpperCase().replace(/-/g, '_')}`;
  }

  static getSessionNameFromEnvKey(envKey: string): string | null {
    const parts = envKey.split(this.SESSION_SEPARATOR);
    if (parts.length !== 2) {
      return null;
    }
    return parts[1].toLowerCase().replace(/_/g, '-');
  }

  static isSessionSpecificEnv(envKey: string): boolean {
    return envKey.includes(this.SESSION_SEPARATOR);
  }
}

/**
 * Per-session webhook configuration
 * Supports session-specific webhook settings via env variables like:
 * WHATSAPP_HOOK_URL__SESSION_NAME=https://example.com/webhook
 */
export class PerSessionWebhookConfig {
  private sessionConfigs: Map<string, WebhookConfig | null> = new Map();

  constructor(
    private configService: ConfigService,
    private sessionName: string,
  ) {}

  private getSessionEnv(envName: Env): string | undefined {
    const sessionEnvKey = SessionEnv.forSession(envName, this.sessionName);
    return this.configService.get(sessionEnvKey);
  }

  private getUrl(): string | undefined {
    return this.getSessionEnv(Env.WHATSAPP_HOOK_URL);
  }

  private getEvents(): WAHAEvents[] {
    const value = this.getSessionEnv(Env.WHATSAPP_HOOK_EVENTS) || '';
    return value ? (value.split(',') as WAHAEvents[]) : [];
  }

  private getHmac(): HmacConfiguration | null {
    const key = this.getSessionEnv(Env.WHATSAPP_HOOK_HMAC_KEY) || '';
    if (!key) {
      return null;
    }
    return {
      key: key,
    };
  }

  private getRetries(): RetriesConfiguration | null {
    const policy: any = this.getSessionEnv(Env.WHATSAPP_HOOK_RETRIES_POLICY);
    const delaySeconds: any = this.getSessionEnv(
      Env.WHATSAPP_HOOK_RETRIES_DELAY_SECONDS,
    );
    const attempts: any = this.getSessionEnv(Env.WHATSAPP_HOOK_RETRIES_ATTEMPTS);
    if (!policy && !delaySeconds && !attempts) {
      return null;
    }
    return {
      policy: policy,
      delaySeconds: delaySeconds,
      attempts: attempts,
    };
  }

  private getCustomHeaders(): CustomHeader[] {
    const value = this.getSessionEnv(Env.WHATSAPP_HOOK_CUSTOM_HEADERS) || '';
    if (!value) {
      return [];
    }
    const headers = value.split(';');
    return headers.map((header: string) => {
      const parts = header.split(':');
      if (parts.length !== 2) {
        throw new Error(
          `Session ${this.sessionName} - Invalid custom header, no ':' found in '${header}'`,
        );
      }
      return {
        name: parts[0],
        value: parts[1],
      };
    });
  }

  get config(): WebhookConfig | null {
    const url = this.getUrl();
    const events = this.getEvents();
    if (!url || events.length === 0) {
      return null;
    }
    const data: WebhookConfig = {
      url: url,
      events: events,
      hmac: this.getHmac(),
      retries: this.getRetries(),
      customHeaders: this.getCustomHeaders(),
    };
    return plainToInstance(WebhookConfig, data, {
      enableImplicitConversion: true,
    });
  }
}

export class GlobalWebhookConfigConfig {
  protected _config: WebhookConfig | null = null;

  constructor(private configService: ConfigService) {}

  private getUrl(): string | undefined {
    return this.configService.get(Env.WHATSAPP_HOOK_URL);
  }

  private getEvents(): WAHAEvents[] {
    const value = this.configService.get(Env.WHATSAPP_HOOK_EVENTS, '');
    return value ? value.split(',') : [];
  }

  private getHmac(): HmacConfiguration | null {
    const key = this.configService.get(Env.WHATSAPP_HOOK_HMAC_KEY, '');
    if (!key) {
      return null;
    }
    return {
      key: key,
    };
  }

  private getRetries(): RetriesConfiguration | null {
    const policy: any = this.configService.get(
      Env.WHATSAPP_HOOK_RETRIES_POLICY,
      null,
    );
    const delaySeconds: any = this.configService.get(
      Env.WHATSAPP_HOOK_RETRIES_DELAY_SECONDS,
      null,
    );
    const attempts: any = this.configService.get(
      Env.WHATSAPP_HOOK_RETRIES_ATTEMPTS,
      null,
    );
    if (!policy && !delaySeconds && !attempts) {
      return null;
    }
    return {
      policy: policy,
      delaySeconds: delaySeconds,
      attempts: attempts,
    };
  }

  private getCustomHeaders(): CustomHeader[] {
    // key:value;key2:value
    const value = this.configService.get(Env.WHATSAPP_HOOK_CUSTOM_HEADERS, '');
    if (!value) {
      return [];
    }
    const headers = value.split(';');
    return headers.map((header: string) => {
      const parts = header.split(':');
      if (parts.length !== 2) {
        throw new Error(
          `${Env.WHATSAPP_HOOK_CUSTOM_HEADERS} - Invalid custom header, no ':' found in '${header}'`,
        );
      }
      return {
        name: parts[0],
        value: parts[1],
      };
    });
  }

  get config() {
    if (!this._config) {
      this._config = this.parseWebhookConfig();
    }
    return this._config;
  }

  validateConfig(): string | null {
    const config = this.parseWebhookConfig();
    if (!config) {
      return null;
    }
    const errors = validateSync(config);
    if (errors.length > 0) {
      return this.formatErrors([], errors, []).join('\n');
    }
    return;
  }

  private getEnv(key: string): string | null {
    const keys = {
      url: Env.WHATSAPP_HOOK_URL,
      events: Env.WHATSAPP_HOOK_EVENTS,
      'retries.policy': Env.WHATSAPP_HOOK_RETRIES_POLICY,
      'retries.delaySeconds': Env.WHATSAPP_HOOK_RETRIES_DELAY_SECONDS,
      'retries.attempts': Env.WHATSAPP_HOOK_RETRIES_ATTEMPTS,
      'hmac.key': Env.WHATSAPP_HOOK_HMAC_KEY,
    };
    return keys[key] || null;
  }

  private formatErrors(
    lines: string[],
    errors: ValidationError[],
    path: string[],
  ) {
    for (const err of errors) {
      path = [...path, err.property];
      for (const key in err.constraints) {
        if (!err.constraints.hasOwnProperty(key)) {
          continue;
        }
        const property = path.join('.');
        const env = this.getEnv(property);
        if (env) {
          const value = this.configService.get(env, '');
          const line = `- ${env} (${property}): '${value}' => '${err.value}' - ${err.constraints[key]}`;
          lines.push(line);
        } else {
          const line = `- ${property}: '${err.value}' - ${err.constraints[key]}`;
          lines.push(line);
        }
      }
      if (err.children) {
        this.formatErrors(lines, err.children, path);
      }
    }
    return lines;
  }

  private parseWebhookConfig(): WebhookConfig | null {
    const url = this.getUrl();
    const events = this.getEvents();
    if (!url || events.length === 0) {
      return null;
    }
    const data: WebhookConfig = {
      url: url,
      events: events,
      hmac: this.getHmac(),
      retries: this.getRetries(),
      customHeaders: this.getCustomHeaders(),
    };
    return plainToInstance(WebhookConfig, data, {
      enableImplicitConversion: true,
    });
  }
}
