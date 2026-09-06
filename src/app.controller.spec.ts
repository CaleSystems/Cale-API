import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  let appService: {
    getHello: jest.Mock;
    checkDbHealth: jest.Mock;
    deepHealth: jest.Mock;
  };

  beforeEach(async () => {
    appService = {
      getHello: jest.fn().mockReturnValue('Hello World!'),
      checkDbHealth: jest.fn(),
      deepHealth: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appService }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('returns ok when the database is reachable', async () => {
      appService.checkDbHealth.mockResolvedValue(true);

      await expect(appController.health()).resolves.toEqual({
        status: 'ok',
        db: 'up',
      });
    });

    it('throws 503 when the database is unreachable', async () => {
      appService.checkDbHealth.mockResolvedValue(false);

      await expect(appController.health()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('health/deep', () => {
    it('returns the report when every configured dependency is up', async () => {
      const report = {
        status: 'ok',
        checks: {
          database: { status: 'up', latencyMs: 3 },
          storage: { status: 'not_configured' },
        },
      };
      appService.deepHealth.mockResolvedValue(report);

      await expect(appController.healthDeep()).resolves.toEqual(report);
    });

    it('throws 503 when a configured dependency is down', async () => {
      appService.deepHealth.mockResolvedValue({
        status: 'error',
        checks: { database: { status: 'down' } },
      });

      await expect(appController.healthDeep()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
