import { ObjectType, Field, registerEnumType } from '@nestjs/graphql';
import { UserRole } from '@prisma/client';

registerEnumType(UserRole, {
  name: 'UserRole',
});

@ObjectType()
export class User {
  @Field()
  address: string;

  @Field(() => UserRole)
  role: UserRole;
}
