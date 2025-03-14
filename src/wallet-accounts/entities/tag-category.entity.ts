import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class TagCategory {
  @Field(() => Int)
  id: number;

  @Field()
  category: string;

  @Field()
  description: string;
}
