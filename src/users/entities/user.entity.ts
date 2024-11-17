import { ObjectType, Field } from '@nestjs/graphql';
import { UserRole } from '@prisma/client';

@ObjectType()
export class User {
  @Field()
  address: string;

  @Field()
  role: UserRole;
}
