import { Module } from '@nestjs/common';
import { WahaMcpService } from './waha-mcp.service';
import { WahaMcpController } from './waha-mcp.controller';

@Module({
  controllers: [WahaMcpController],
  providers: [WahaMcpService],
  exports: [WahaMcpService],
})
export class WahaMcpModule {}
