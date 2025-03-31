import { ObjectType, Field, Int } from '@nestjs/graphql';

import { Tag } from './tag.entity';

@ObjectType()
export class WalletAccount {
  @Field(() => Int)
  id: number;

  @Field()
  userId: string;

  @Field()
  address: string;

  @Field(() => [Tag])
  tags: Tag[];
}
