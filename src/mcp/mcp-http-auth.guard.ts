import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { HashAuth, IApiKeyAuth, NoAuth, PlainApiKeyAuth } from '@waha/core/auth/auth';
import { WhatsappConfigService } from '@waha/config.service';

@Injectable()
export class McpHttpAuthGuard implements CanActivate {
  private readonly logger = new Logger(McpHttpAuthGuard.name);
  private readonly dedicatedAuth: IApiKeyAuth | null;

  constructor(
    private readonly defaultAuth: IApiKeyAuth,
    private readonly configService: WhatsappConfigService,
  ) {
    this.dedicatedAuth = this.createAuth(process.env.WAHA_MCP_HTTP_API_KEY);
    if (this.dedicatedAuth) {
      this.logger.log('WAHA_MCP_HTTP_API_KEY configured for MCP HTTP requests');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request) {
      return false;
    }

    this.logger.log('Evaluating MCP HTTP request');

    // Step 1: Authenticate the request
    if (!this.isAuthorizedByDedicatedKey(request)) {
      if (!(this.defaultAuth instanceof NoAuth)) {
        const apiKey = this.extractApiKey(request);
        if (!apiKey || !this.defaultAuth.isValid(apiKey)) {
          this.logger.warn(
            'Rejected MCP HTTP request: invalid or missing API key',
          );
          throw new UnauthorizedException();
        }
      }
    } else {
      this.logger.log('Authorized MCP HTTP request via WAHA_MCP_HTTP_API_KEY');
    }

    // Step 2: Validate session allowlist (early rejection for HTTP transport)
    const sessionName = this.extractSessionFromRequest(request);
    if (sessionName) {
      this.validateMcpSessionAccess(sessionName);
    }

    return true;
  }

  private isAuthorizedByDedicatedKey(request: Request): boolean {
    if (!this.dedicatedAuth) {
      return false;
    }

    const apiKey = this.extractApiKey(request);
    if (!apiKey) {
      return false;
    }

    return this.dedicatedAuth.isValid(apiKey);
  }

  private extractApiKey(request: Request): string | undefined {
    return request.header('x-api-key') ?? undefined;
  }

  private createAuth(value?: string | null): IApiKeyAuth | null {
    if (!value) {
      return null;
    }

    if (value.startsWith('sha512:')) {
      return new HashAuth(value.slice(7), 'sha512');
    }

    return new PlainApiKeyAuth(value);
  }

  /**
   * Extract session name from MCP request body if present.
   * MCP tool calls include the session parameter in the request body.
   * Returns null if no session parameter is found.
   */
  private extractSessionFromRequest(request: Request): string | null {
    try {
      const body = request.body;
      if (!body) {
        return null;
      }

      // MCP protocol structure: body.params.arguments contains tool parameters
      const args = body?.params?.arguments;
      if (args && typeof args === 'object' && 'session' in args) {
        const session = args.session;
        if (typeof session === 'string' && session.length > 0) {
          return session;
        }
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to extract session from MCP request', error);
      return null;
    }
  }

  /**
   * Validate that the session is allowed for MCP access.
   * Throws ForbiddenException if the session is not in the allowlist.
   */
  private validateMcpSessionAccess(sessionName: string): void {
    if (!this.configService.isMcpSessionAllowed(sessionName)) {
      const allowedSessions = this.configService.getMcpAllowedSessions();
      const allowedList =
        allowedSessions && allowedSessions.length > 0
          ? allowedSessions.join(', ')
          : 'none configured';

      this.logger.warn(
        `MCP HTTP request rejected: session "${sessionName}" not in allowlist. Allowed: ${allowedList}`,
      );

      throw new ForbiddenException(
        `Session "${sessionName}" is not allowed for MCP access. ` +
        `Allowed sessions: ${allowedList}. ` +
        `Configure WAHA_MCP_ALLOWED_SESSIONS to grant access.`,
      );
    }
  }
}
