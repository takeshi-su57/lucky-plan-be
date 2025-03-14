import { ObjectType, Field } from '@nestjs/graphql';

import { Tag } from './tag.entity';

@ObjectType()
export class WalletAccount {
  @Field()
  address: string;

  @Field(() => [Tag])
  tags: Tag[];
}
