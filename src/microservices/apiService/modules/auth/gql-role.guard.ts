import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { UserPermission } from 'generated/prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { LogsService } from 'src/global/logs.service';

const PermissionPriority = {
  [UserPermission.Admin]: 2,
  [UserPermission.Trader]: 1,
  [UserPermission.Trial]: 0,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private logger: LogsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserPermission[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true;
    }

    const ctx = GqlExecutionContext.create(context);
    const { user } = ctx.getContext().req;

    if (!user) {
      return false;
    }

    const maximumPermission = Math.max(
      ...requiredRoles.map((item) => PermissionPriority[item]),
    );

    const userPermission =
      PermissionPriority[user.permission as UserPermission];

    this.logger.nativeLog({
      severity: 'Info',
      summary: `user: ${JSON.stringify(user)} userPermission: ${userPermission} maximumPermission: ${maximumPermission}`,
    });

    return userPermission >= maximumPermission;
  }
}
