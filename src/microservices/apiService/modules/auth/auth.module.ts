import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import 'dotenv';

import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || '',
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN || '1h') as StringValue,
      },
    }),
  ],
  providers: [AuthResolver, AuthService, JwtStrategy],
})
export class AuthModule {}
