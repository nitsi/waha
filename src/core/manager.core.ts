import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AppsService,
  IAppsService,
} from '@waha/apps/app_sdk/services/IAppsService';
import { EngineBootstrap } from '@waha/core/abc/EngineBootstrap';
import { GowsEngineConfigService } from '@waha/core/config/GowsEngineConfigService';
import { WebJSEngineConfigService } from '@waha/core/config/WebJSEngineConfigService';
import { WhatsappSessionGoWSCore } from '@waha/core/engines/gows/session.gows.core';
import { WebhookConductor } from '@waha/core/integrations/webhooks/WebhookConductor';
import { MediaStorageFactory } from '@waha/core/media/MediaStorageFactory';
import { DefaultMap } from '@waha/utils/DefaultMap';
import { getPinoLogLevel, LoggerBuilder } from '@waha/utils/logging';
import { promiseTimeout, sleep } from '@waha/utils/promiseTimeout';
import { complete } from '@waha/utils/reactive/complete';
import { SwitchObservable } from '@waha/utils/reactive/SwitchObservable';
import { PinoLogger } from 'nestjs-pino';
import { Observable, retry, share } from 'rxjs';
import { map } from 'rxjs/operators';

import { WhatsappConfigService } from '../config.service';
import {
  WAHAEngine,
  WAHAEvents,
  WAHASessionStatus,
} from '../structures/enums.dto';
import {
  ProxyConfig,
  SessionConfig,
  SessionDetailedInfo,
  SessionDTO,
  SessionInfo,
} from '../structures/sessions.dto';
import { WebhookConfig } from '../structures/webhooks.config.dto';
import { populateSessionInfo, SessionManager } from './abc/manager.abc';
import { SessionParams, WhatsappSession } from './abc/session.abc';
import { EngineConfigService } from './config/EngineConfigService';
import { WhatsappSessionNoWebCore } from './engines/noweb/session.noweb.core';
import { WhatsappSessionWebJSCore } from './engines/webjs/session.webjs.core';
import { DOCS_URL } from './exceptions';
import { getProxyConfig } from './helpers.proxy';
import { MediaManager } from './media/MediaManager';
import { LocalSessionAuthRepository } from './storage/LocalSessionAuthRepository';
import { LocalSessionConfigRepository } from './storage/LocalSessionConfigRepository';
import { LocalStoreCore } from './storage/LocalStoreCore';

@Injectable()
export class SessionManagerCore extends SessionManager implements OnModuleInit {
  SESSION_STOP_TIMEOUT = 3000;

  // Map of session name to session instance
  private sessions: Map<string, WhatsappSession>;
  // Map of session name to session config (in-memory cache)
  private sessionConfigs: Map<string, SessionConfig>;
  DEFAULT = 'default';

  protected readonly EngineClass: typeof WhatsappSession;
  // Map of session name to its events
  protected events2: Map<string, DefaultMap<WAHAEvents, SwitchObservable<any>>>;
  protected readonly engineBootstrap: EngineBootstrap;

  constructor(
    config: WhatsappConfigService,
    private engineConfigService: EngineConfigService,
    private webjsEngineConfigService: WebJSEngineConfigService,
    gowsConfigService: GowsEngineConfigService,
    log: PinoLogger,
    private mediaStorageFactory: MediaStorageFactory,
    @Inject(AppsService)
    appsService: IAppsService,
  ) {
    super(log, config, gowsConfigService, appsService);
    this.sessions = new Map();
    this.sessionConfigs = new Map();
    const engineName = this.engineConfigService.getDefaultEngineName();
    this.EngineClass = this.getEngine(engineName);
    this.engineBootstrap = this.getEngineBootstrap(engineName);

    this.events2 = new Map();

    this.store = new LocalStoreCore(engineName.toLowerCase());
    this.sessionAuthRepository = new LocalSessionAuthRepository(this.store);
    this.sessionConfigRepository = new LocalSessionConfigRepository(this.store);
    this.clearStorage().catch((error) => {
      this.log.error({ error }, 'Error while clearing storage');
    });
  }

  protected getEngine(engine: WAHAEngine): typeof WhatsappSession {
    if (engine === WAHAEngine.WEBJS) {
      return WhatsappSessionWebJSCore;
    } else if (engine === WAHAEngine.NOWEB) {
      return WhatsappSessionNoWebCore;
    } else if (engine === WAHAEngine.GOWS) {
      return WhatsappSessionGoWSCore;
    } else {
      throw new NotFoundException(`Unknown whatsapp engine '${engine}'.`);
    }
  }

  private getSessionEventMap(
    name: string,
  ): DefaultMap<WAHAEvents, SwitchObservable<any>> {
    if (!this.events2.has(name)) {
      this.events2.set(
        name,
        new DefaultMap<WAHAEvents, SwitchObservable<any>>(
          (key) =>
            new SwitchObservable((obs$) => {
              return obs$.pipe(retry(), share());
            }),
        ),
      );
    }
    return this.events2.get(name)!;
  }

  async beforeApplicationShutdown(signal?: string) {
    const sessionNames = Array.from(this.sessions.keys());
    for (const name of sessionNames) {
      await this.stop(name, true);
    }
    this.stopEvents();
    await this.engineBootstrap.shutdown();
  }

  async onApplicationBootstrap() {
    await this.engineBootstrap.bootstrap();
    this.startPredefinedSessions();
  }

  private async clearStorage() {
    const storage = await this.mediaStorageFactory.build(
      'all',
      this.log.logger.child({ name: 'Storage' }),
    );
    await storage.purge();
  }

  //
  // API Methods
  //
  async exists(name: string): Promise<boolean> {
    // Check in-memory cache first
    if (this.sessionConfigs.has(name)) {
      return true;
    }
    // Check persisted config
    return await this.sessionConfigRepository.exists(name);
  }

  isRunning(name: string): boolean {
    return this.sessions.has(name);
  }

  async upsert(name: string, config?: SessionConfig): Promise<void> {
    const sessionConfig = config || {};
    // Update in-memory cache
    this.sessionConfigs.set(name, sessionConfig);
    // Persist to disk
    await this.sessionConfigRepository.saveConfig(name, sessionConfig);
  }

  async start(name: string): Promise<SessionDTO> {
    if (this.sessions.has(name)) {
      throw new UnprocessableEntityException(
        `Session '${name}' is already started.`,
      );
    }
    this.log.info({ session: name }, `Starting session...`);

    // Load config from disk if not in memory
    let sessionConfig = this.sessionConfigs.get(name);
    if (!sessionConfig) {
      sessionConfig = await this.sessionConfigRepository.getConfig(name);
      if (sessionConfig) {
        this.sessionConfigs.set(name, sessionConfig);
      }
    }

    const logger = this.log.logger.child({ session: name });
    logger.level = getPinoLogLevel(sessionConfig?.debug);
    const loggerBuilder: LoggerBuilder = logger;

    const storage = await this.mediaStorageFactory.build(
      name,
      loggerBuilder.child({ name: 'Storage' }),
    );
    await storage.init();
    const mediaManager = new MediaManager(
      storage,
      this.config.mimetypes,
      loggerBuilder.child({ name: 'MediaManager' }),
    );

    const webhook = new WebhookConductor(loggerBuilder);
    const proxyConfig = this.getProxyConfig(name, sessionConfig);
    const sessionParams: SessionParams = {
      name,
      mediaManager,
      loggerBuilder,
      printQR: this.engineConfigService.shouldPrintQR,
      sessionStore: this.store,
      proxyConfig: proxyConfig,
      sessionConfig: sessionConfig,
      ignore: this.ignoreChatsConfig(sessionConfig),
    };
    if (this.EngineClass === WhatsappSessionWebJSCore) {
      sessionParams.engineConfig = this.webjsEngineConfigService.getConfig();
    } else if (this.EngineClass === WhatsappSessionGoWSCore) {
      sessionParams.engineConfig = this.gowsConfigService.getConfig();
    }
    await this.sessionAuthRepository.init(name);
    // @ts-ignore
    const session = new this.EngineClass(sessionParams);
    this.sessions.set(name, session);
    this.updateSession(name);

    // configure webhooks
    const webhooks = this.getWebhooks(name, sessionConfig);
    webhook.configure(session, webhooks);

    // Apps
    await this.appsService.beforeSessionStart(session, this.store);

    // start session
    await session.start();
    logger.info('Session has been started.');

    // Apps
    await this.appsService.afterSessionStart(session, this.store);

    return {
      name: session.name,
      status: session.status,
      config: session.sessionConfig,
    };
  }

  private updateSession(name: string) {
    const session = this.sessions.get(name);
    if (!session) {
      return;
    }
    const eventMap = this.getSessionEventMap(name);
    for (const eventName in WAHAEvents) {
      const event = WAHAEvents[eventName];
      const stream$ = session
        .getEventObservable(event)
        .pipe(map(populateSessionInfo(event, session)));
      eventMap.get(event).switch(stream$);
    }
  }

  getSessionEvent(sessionName: string, event: WAHAEvents): Observable<any> {
    const eventMap = this.getSessionEventMap(sessionName);
    return eventMap.get(event);
  }

  async stop(name: string, silent: boolean): Promise<void> {
    if (!this.isRunning(name)) {
      this.log.debug({ session: name }, `Session is not running.`);
      return;
    }

    this.log.info({ session: name }, `Stopping session...`);
    try {
      const session = this.getSession(name);
      await session.stop();
    } catch (err) {
      this.log.warn(`Error while stopping session '${name}'`);
      if (!silent) {
        throw err;
      }
    }
    this.log.info({ session: name }, `Session has been stopped.`);
    this.sessions.delete(name);
    this.updateSession(name);
    await sleep(this.SESSION_STOP_TIMEOUT);
  }

  async unpair(name: string) {
    const session = this.sessions.get(name);
    if (!session) {
      return;
    }

    this.log.info({ session: name }, 'Unpairing the device from account...');
    await session.unpair().catch((err) => {
      this.log.warn(`Error while unpairing from device: ${err}`);
    });
    await sleep(1000);
  }

  async logout(name: string): Promise<void> {
    await this.sessionAuthRepository.clean(name);
  }

  async delete(name: string): Promise<void> {
    this.sessions.delete(name);
    this.sessionConfigs.delete(name);
    this.events2.delete(name);
    // Delete persisted config
    await this.sessionConfigRepository.deleteConfig(name);
  }

  /**
   * Combine per session and global webhooks
   * Priority order:
   * 1. Session config webhooks (from API/DB)
   * 2. Session-specific env webhooks (WHATSAPP_HOOK_URL__SESSION_NAME)
   * 3. Global env webhooks (WHATSAPP_HOOK_URL)
   */
  private getWebhooks(name: string, sessionConfig?: SessionConfig) {
    let webhooks: WebhookConfig[] = [];

    // 1. Session config webhooks (highest priority)
    if (sessionConfig?.webhooks) {
      webhooks = webhooks.concat(sessionConfig.webhooks);
    }

    // 2. Session-specific env webhook or global env webhook
    const envWebhookConfig = this.config.getSessionWebhookConfig(name);
    if (envWebhookConfig) {
      webhooks.push(envWebhookConfig);
    }

    return webhooks;
  }

  /**
   * Get either session's or global proxy if defined
   */
  protected getProxyConfig(
    name: string,
    sessionConfig?: SessionConfig,
  ): ProxyConfig | undefined {
    if (sessionConfig?.proxy) {
      return sessionConfig.proxy;
    }
    const session = this.sessions.get(name);
    if (!session) {
      return undefined;
    }
    const sessions = { [name]: session };
    return getProxyConfig(this.config, sessions, name);
  }

  getSession(name: string): WhatsappSession {
    const session = this.sessions.get(name);
    if (!session) {
      throw new NotFoundException(
        `We didn't find a session with name '${name}'.\n` +
          `Please start it first by using POST /api/sessions/${name}/start request`,
      );
    }
    return session;
  }

  async getSessions(all: boolean): Promise<SessionInfo[]> {
    const result: SessionInfo[] = [];

    // Add all running sessions
    for (const [name, session] of this.sessions.entries()) {
      const me = session.getSessionMeInfo();
      result.push({
        name: session.name,
        status: session.status,
        config: session.sessionConfig,
        me: me,
        presence: session.presence,
        timestamps: {
          activity: session?.getLastActivityTimestamp(),
        },
      });
    }

    // If all=true, also include stopped sessions (configs without running sessions)
    if (all) {
      // Load all persisted configs
      const allSessionNames = await this.sessionConfigRepository.getAllConfigs();

      for (const name of allSessionNames) {
        // Skip if already running
        if (this.sessions.has(name)) {
          continue;
        }

        // Load config if not in memory
        let config = this.sessionConfigs.get(name);
        if (!config) {
          config = await this.sessionConfigRepository.getConfig(name);
          if (config) {
            this.sessionConfigs.set(name, config);
          }
        }

        result.push({
          name: name,
          status: WAHASessionStatus.STOPPED,
          config: config || {},
          me: null,
          presence: null,
          timestamps: {
            activity: null,
          },
        });
      }
    }

    return result;
  }

  private async fetchEngineInfo(name: string) {
    const session = this.sessions.get(name);
    // Get engine info
    let engineInfo = {};
    if (session) {
      try {
        engineInfo = await promiseTimeout(1000, session.getEngineInfo());
      } catch (error) {
        this.log.debug(
          { session: session.name, error: `${error}` },
          'Can not get engine info',
        );
      }
    }
    const engine = {
      engine: session?.engine,
      ...engineInfo,
    };
    return engine;
  }

  async getSessionInfo(name: string): Promise<SessionDetailedInfo | null> {
    const sessions = await this.getSessions(true);
    const session = sessions.find((s) => s.name === name);
    if (!session) {
      return null;
    }
    const engine = await this.fetchEngineInfo(name);
    return { ...session, engine: engine };
  }

  protected stopEvents() {
    for (const eventMap of this.events2.values()) {
      complete(eventMap);
    }
  }

  async onModuleInit() {
    await this.init();
  }

  async init() {
    await this.store.init();
    const knex = this.store.getWAHADatabase();
    await this.appsService.migrate(knex);

    // Load all persisted session configs into memory
    await this.loadPersistedConfigs();
  }

  /**
   * Load all persisted session configs from disk into memory
   */
  private async loadPersistedConfigs() {
    try {
      const sessionNames = await this.sessionConfigRepository.getAllConfigs();
      this.log.info(
        { count: sessionNames.length },
        'Loading persisted session configs...',
      );

      for (const name of sessionNames) {
        const config = await this.sessionConfigRepository.getConfig(name);
        if (config) {
          this.sessionConfigs.set(name, config);
          this.log.debug({ session: name }, 'Loaded session config from disk');
        }
      }

      this.log.info(
        { count: this.sessionConfigs.size },
        'Loaded persisted session configs',
      );
    } catch (error) {
      this.log.error({ error }, 'Failed to load persisted session configs');
    }
  }
}
