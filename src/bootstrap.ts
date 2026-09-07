import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Shared app configuration, applied identically by `main.ts` and the e2e
 * suite. It lives here rather than inline in `bootstrap()` so the tests
 * exercise the real routing: the global prefix and its health-check
 * exclusions are the kind of thing that only breaks in production if the
 * tests quietly run without them.
 */
export function configureApp(app: INestApplication): INestApplication {
  // Every domain route is versioned from the start. One of this platform's
  // clients is an installed APK on a register that can be offline for days,
  // so there is no lockstep API/client deploy — a breaking change needs a v2
  // to live alongside v1, and that needs a prefix to hang it on.
  //
  // Health checks are deliberately excluded: Render polls `/health`, and
  // moving it would turn a routine deploy into a failed one.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/deep'] });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  return app;
}
