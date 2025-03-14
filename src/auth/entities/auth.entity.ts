import { ObjectType, Field, registerEnumType } from '@nestjs/graphql';
import { UserPermission } from '@prisma/client';

registerEnumType(UserPermission, {
  name: 'UserPermission',
});

@ObjectType()
export class User {
  @Field()
  address: string;

  @Field(() => UserPermission)
  permission: UserPermission;
}

@ObjectType()
export class AccessToken {
  @Field()
  accessToken: string;
}
