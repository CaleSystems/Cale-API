import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessTokenPayload } from './auth.service';

export interface AuthenticatedUser {
  staffId: string;
  branchId: string;
  role: string;
  sessionId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
    });
  }

  validate(payload: AccessTokenPayload): AuthenticatedUser {
    return {
      staffId: payload.sub,
      branchId: payload.branchId,
      role: payload.role,
      sessionId: payload.jti,
    };
  }
}
