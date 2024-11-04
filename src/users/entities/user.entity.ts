import { ObjectType, Field } from '@nestjs/graphql';
import { UserRole } from '@prisma/client';
import { Address } from 'viem';

@ObjectType()
export class User {
  @Field()
  address: Address;

  @Field()
  role: UserRole;
}
