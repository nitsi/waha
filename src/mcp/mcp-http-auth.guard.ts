import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { HashAuth, IApiKeyAuth, PlainApiKeyAuth } from '@waha/core/auth/auth';

@Injectable()
export class McpHttpAuthGuard implements CanActivate {
  private readonly logger = new Logger(McpHttpAuthGuard.name);
  private readonly dedicatedAuth: IApiKeyAuth | null;

  constructor(private readonly defaultAuth: IApiKeyAuth) {
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

    if (this.isAuthorizedByDedicatedKey(request)) {
      this.logger.log('Authorized MCP HTTP request via WAHA_MCP_HTTP_API_KEY');
      return true;
    }

    if (this.defaultAuth.skipAuth()) {
      return true;
    }

    const apiKey = this.extractApiKey(request);
    if (apiKey && this.defaultAuth.isValid(apiKey)) {
      return true;
    }

    this.logger.warn('Rejected MCP HTTP request: invalid or missing API key');
    throw new UnauthorizedException();
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
}
