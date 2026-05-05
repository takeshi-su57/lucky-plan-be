import {
  ObjectType,
  Field,
  registerEnumType,
  Float,
  Int,
} from '@nestjs/graphql';
import { UserPermission } from 'generated/prisma/client';

registerEnumType(UserPermission, {
  name: 'UserPermission',
});

@ObjectType()
export class User {
  @Field()
  address: string;

  @Field(() => String, { nullable: true })
  secondAddress?: string | null;

  @Field(() => UserPermission)
  permission: UserPermission;

  @Field(() => Boolean)
  allowAuto: boolean;

  @Field(() => Float)
  budget: number;

  @Field(() => Float)
  ratio: number;

  @Field(() => Int)
  followerContractId: number;
}

@ObjectType()
export class AccessToken {
  @Field()
  accessToken: string;
}
