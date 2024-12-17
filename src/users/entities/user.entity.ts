import { ObjectType, Field, registerEnumType } from '@nestjs/graphql';
import { UserRole } from '@prisma/client';
import { TradeHistory } from 'src/trade-histories/entities/trade-history.entity';

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

@ObjectType()
export class UserHistory extends User {
  @Field(() => [TradeHistory])
  histories: TradeHistory[];
}
