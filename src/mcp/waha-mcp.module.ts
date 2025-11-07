import { Module } from '@nestjs/common';
import { WahaMcpService } from './waha-mcp.service';

@Module({
  providers: [WahaMcpService],
  exports: [WahaMcpService],
})
export class WahaMcpModule {}
