import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/bootstrap';

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/v1 (GET) — domain routes are versioned', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect('Hello World!');
  });

  it('/ (GET) — unversioned root is not served', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });

  it('/health (GET) — stays unprefixed, because Render polls it', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', db: 'up' });
  });

  it('/api/v1/health (GET) — health is NOT under the prefix', () => {
    // Guards the deploy-breaking regression: if the exclusion is ever dropped,
    // Render's health check 404s and every deploy fails.
    return request(app.getHttpServer()).get('/api/v1/health').expect(404);
  });

  it('/health/deep (GET) — reports each dependency', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/deep')
      .expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database.status).toBe('up');
    expect(typeof res.body.checks.database.latencyMs).toBe('number');
    // Unwired dependencies are reported honestly, and do not fail the check.
    expect(res.body.checks.storage.status).toBe('not_configured');
  });
});
