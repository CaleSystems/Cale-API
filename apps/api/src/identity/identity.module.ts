import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IdentityRepository } from './identity.repository';
import { JwtStrategy } from './jwt.strategy';

@Module({
  // No default secret registered here — access and refresh tokens use
  // different secrets, passed explicitly on each sign/verify call in
  // AuthService, so a leaked access-token secret can't forge a refresh token.
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, IdentityRepository, JwtStrategy],
})
export class IdentityModule {}
