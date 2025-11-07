import { All, Controller, Req, Res, UseGuards } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { WahaMcpService } from './waha-mcp.service';
import { McpHttpAuthGuard } from './mcp-http-auth.guard';

@ApiSecurity('api_key')
@UseGuards(McpHttpAuthGuard)
@Controller('mcp')
export class WahaMcpController {
  constructor(private readonly mcpService: WahaMcpService) {}

  @All()
  async handleMcpRequest(@Req() req: Request, @Res() res: Response) {
    await this.mcpService.handleHttpRequest(req, res);
  }
}
