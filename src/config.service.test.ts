import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { WhatsappConfigService } from './config.service';

describe('WhatsappConfigService - MCP Allowlist', () => {
  let service: WhatsappConfigService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappConfigService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WhatsappConfigService>(WhatsappConfigService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('getMcpAllowedSessions', () => {
    it('should return null when WAHA_MCP_ALLOWED_SESSIONS is not set', () => {
      jest.spyOn(configService, 'get').mockReturnValue('');
      const result = service.getMcpAllowedSessions();
      expect(result).toBeNull();
    });

    it('should return null when WAHA_MCP_ALLOWED_SESSIONS is empty string', () => {
      jest.spyOn(configService, 'get').mockReturnValue('   ');
      const result = service.getMcpAllowedSessions();
      expect(result).toBeNull();
    });

    it('should parse single session name', () => {
      jest.spyOn(configService, 'get').mockReturnValue('default');
      const result = service.getMcpAllowedSessions();
      expect(result).toEqual(['default']);
    });

    it('should parse multiple comma-separated session names', () => {
      jest
        .spyOn(configService, 'get')
        .mockReturnValue('session1,session2,session3');
      const result = service.getMcpAllowedSessions();
      expect(result).toEqual(['session1', 'session2', 'session3']);
    });

    it('should trim whitespace from session names', () => {
      jest
        .spyOn(configService, 'get')
        .mockReturnValue(' session1 , session2 , session3 ');
      const result = service.getMcpAllowedSessions();
      expect(result).toEqual(['session1', 'session2', 'session3']);
    });

    it('should filter out empty entries', () => {
      jest
        .spyOn(configService, 'get')
        .mockReturnValue('session1,,session2,  ,session3');
      const result = service.getMcpAllowedSessions();
      expect(result).toEqual(['session1', 'session2', 'session3']);
    });

    it('should deduplicate session names', () => {
      jest
        .spyOn(configService, 'get')
        .mockReturnValue('session1,session2,session1,session3,session2');
      const result = service.getMcpAllowedSessions();
      expect(result).toEqual(['session1', 'session2', 'session3']);
    });

    it('should cache the parsed result on subsequent calls', () => {
      const getSpy = jest
        .spyOn(configService, 'get')
        .mockReturnValue('session1,session2');

      const result1 = service.getMcpAllowedSessions();
      const result2 = service.getMcpAllowedSessions();

      expect(result1).toEqual(['session1', 'session2']);
      expect(result2).toEqual(['session1', 'session2']);
      expect(getSpy).toHaveBeenCalledTimes(1); // Only called once due to caching
    });
  });

  describe('isMcpSessionAllowed', () => {
    it('should return false when allowlist is not configured', () => {
      jest.spyOn(configService, 'get').mockReturnValue('');
      expect(service.isMcpSessionAllowed('session1')).toBe(false);
    });

    it('should return false when allowlist is empty', () => {
      jest.spyOn(configService, 'get').mockReturnValue('   ');
      expect(service.isMcpSessionAllowed('session1')).toBe(false);
    });

    it('should return true when session is in the allowlist', () => {
      jest
        .spyOn(configService, 'get')
        .mockReturnValue('session1,session2,session3');
      expect(service.isMcpSessionAllowed('session2')).toBe(true);
    });

    it('should return false when session is not in the allowlist', () => {
      jest
        .spyOn(configService, 'get')
        .mockReturnValue('session1,session2,session3');
      expect(service.isMcpSessionAllowed('session4')).toBe(false);
    });

    it('should handle exact match (case-sensitive)', () => {
      jest.spyOn(configService, 'get').mockReturnValue('Session1,session2');
      expect(service.isMcpSessionAllowed('Session1')).toBe(true);
      expect(service.isMcpSessionAllowed('session1')).toBe(false);
    });
  });

  describe('onApplicationBootstrap', () => {
    it('should log warning when MCP is enabled but allowlist is empty', () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn');
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'WAHA_MCP_ENABLED') return 'true';
        if (key === 'WAHA_MCP_ALLOWED_SESSIONS') return '';
        return undefined;
      });

      service.onApplicationBootstrap();

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'MCP is enabled but WAHA_MCP_ALLOWED_SESSIONS is not configured',
        ),
      );
    });

    it('should log info when MCP is enabled with configured allowlist', () => {
      const loggerLogSpy = jest.spyOn(service['logger'], 'log');
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'WAHA_MCP_ENABLED') return 'true';
        if (key === 'WAHA_MCP_ALLOWED_SESSIONS') return 'session1,session2';
        return undefined;
      });

      service.onApplicationBootstrap();

      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'MCP allowlist configured with 2 session(s): session1, session2',
        ),
      );
    });

    it('should not log MCP warnings when MCP is disabled', () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn');
      const loggerLogSpy = jest.spyOn(service['logger'], 'log');
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'WAHA_MCP_ENABLED') return 'false';
        return undefined;
      });

      service.onApplicationBootstrap();

      expect(loggerWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('MCP is enabled'),
      );
      expect(loggerLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('MCP allowlist'),
      );
    });
  });
});
