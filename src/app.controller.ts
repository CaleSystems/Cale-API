import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService, DeepHealthReport } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** Shallow — what Render polls. Keep it cheap and keep it at this path. */
  @Get('health')
  async health(): Promise<{ status: string; db: string }> {
    const dbUp = await this.appService.checkDbHealth();
    if (!dbUp) {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
    return { status: 'ok', db: 'up' };
  }

  /** Deep — per-dependency detail for alerting. Never wire a probe to this. */
  @Get('health/deep')
  async healthDeep(): Promise<DeepHealthReport> {
    const report = await this.appService.deepHealth();
    if (report.status === 'error') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
