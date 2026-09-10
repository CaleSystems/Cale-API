/**
 * Throttle tiers.
 *
 * `ThrottlerModule.forRoot` in `app.module.ts` defines a single `default`
 * throttler that applies to every route as a floor. These constants override
 * that floor on the routes that need a different one, via the decorator:
 *
 *   @Throttle(AUTH_THROTTLE)
 *   @Post('login')
 *
 * They are deliberately NOT registered as additional named throttlers in
 * `forRoot`: every throttler in that array applies to every route, so adding
 * an `auth` tier there would clamp the whole API to the auth limit.
 *
 * AUTH_THROTTLE is consumed by identity/auth.controller.ts. SYNC_THROTTLE has
 * no consumer yet — there's no sync route — but exists so the first one
 * written picks the right tier instead of inheriting the floor.
 */

const MINUTE = 60_000;

/** Login, token refresh, PIN verification — credential-guessing surface. */
export const AUTH_THROTTLE = { default: { limit: 10, ttl: MINUTE } };

/** Offline outbox drain — bursty by design; a register back online pushes a queue. */
export const SYNC_THROTTLE = { default: { limit: 120, ttl: MINUTE } };
