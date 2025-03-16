import { SetMetadata } from '@nestjs/common';
import { UserPermission } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserPermission[]) =>
  SetMetadata(ROLES_KEY, roles);
