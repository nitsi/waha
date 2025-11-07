import { All, Controller, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { WahaMcpService } from './waha-mcp.service';

@Controller('mcp')
export class WahaMcpController {
  constructor(private readonly mcpService: WahaMcpService) {}

  @All()
  async handleMcpRequest(@Req() req: Request, @Res() res: Response) {
    await this.mcpService.handleHttpRequest(req, res);
  }
}
