import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Guard for internal API endpoints called by optimizer.py
 * Validates the X-Internal-Secret header against BACKTEST_INTERNAL_SECRET env var
 */
@Injectable()
export class InternalApiGuard implements CanActivate {
  private readonly secret: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.secret = this.configService.get<string>('BACKTEST_INTERNAL_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    // If no secret is configured, allow all requests (dev mode)
    if (!this.secret) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const providedSecret = request.headers['x-internal-secret'];

    if (!providedSecret || providedSecret !== this.secret) {
      throw new UnauthorizedException('Invalid or missing internal API secret');
    }

    return true;
  }
}
