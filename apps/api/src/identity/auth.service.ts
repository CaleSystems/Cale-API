import type { AuthTokens } from '@cale/contracts';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { IdentityRepository } from './identity.repository';

// Access: short-lived per PLATFORM_SETUP.md's "~15 min". Refresh: a staff
// shift session per D3 ("short-lived, PIN unlock") — 12h covers one shift
// without staying live indefinitely.
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export interface AccessTokenPayload {
  sub: string; // staffId
  branchId: string;
  role: string;
  jti: string; // sessionId
  type: 'access';
}

interface RefreshTokenPayload {
  sub: string;
  jti: string; // sessionId — for the DB lookup, not for uniqueness
  // A fresh random value per issuance. Without this, two rotations signed
  // within the same wall-clock second are byte-identical JWTs (HS256 is
  // deterministic given the same header+payload+secret, and jti/iat/exp are
  // otherwise unchanged across a rotation) — the old "replay" token isn't
  // actually distinguishable from the new one, silently defeating rotation.
  nonce: string;
  type: 'refresh';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: IdentityRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(
    staffId: string,
    branchId: string,
    pin: string,
  ): Promise<AuthTokens> {
    const staffRow = await this.repo.findStaffById(staffId);
    if (!staffRow) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // D3: dismissal-for-cause blocks new sessions outright, not just future
    // offline-mutation syncs.
    if (staffRow.revokedForCauseAt) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!(await argon2.verify(staffRow.pinHash, pin))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const assignment = await this.repo.findCurrentAssignment(staffId, branchId);
    if (!assignment) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueSession(staffId, branchId, assignment.role);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.repo.findActiveSessionById(payload.jti);
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // A presented token that doesn't match the stored hash means either a
    // forged token (caught above by signature) or replay of a token that
    // was already rotated out — treat replay as compromise and kill the
    // session rather than silently rejecting just this one request.
    if (!(await argon2.verify(session.refreshTokenHash, refreshToken))) {
      await this.repo.revokeSession(session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const assignment = await this.repo.findCurrentAssignment(
      session.staffId,
      session.branchId,
    );
    if (!assignment) {
      await this.repo.revokeSession(session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueSession(
      session.staffId,
      session.branchId,
      assignment.role,
      session.id,
    );
  }

  async logout(sessionId: string): Promise<void> {
    await this.repo.revokeSession(sessionId);
  }

  private async issueSession(
    staffId: string,
    branchId: string,
    role: string,
    existingSessionId?: string,
  ): Promise<AuthTokens> {
    const sessionId = existingSessionId ?? randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const refreshPayload: RefreshTokenPayload = {
      sub: staffId,
      jti: sessionId,
      nonce: randomUUID(),
      type: 'refresh',
    };
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.refreshSecret(),
      expiresIn: REFRESH_TOKEN_TTL_MS / 1000,
    });
    const refreshTokenHash = await argon2.hash(refreshToken, {
      type: argon2.argon2id,
    });

    if (existingSessionId) {
      await this.repo.rotateSession(sessionId, { refreshTokenHash, expiresAt });
    } else {
      await this.repo.createSession({
        id: sessionId,
        staffId,
        branchId,
        refreshTokenHash,
        expiresAt,
      });
    }

    const accessPayload: AccessTokenPayload = {
      sub: staffId,
      branchId,
      role,
      jti: sessionId,
      type: 'access',
    };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.accessSecret(),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  private accessSecret(): string {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not set');
    return secret;
  }

  private refreshSecret(): string {
    const secret = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!secret) throw new Error('JWT_REFRESH_SECRET is not set');
    return secret;
  }
}
