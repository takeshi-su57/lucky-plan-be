import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class Tag {
  @Field(() => Int)
  id: number;

  @Field()
  userId: string;

  @Field()
  tag: string;

  @Field()
  description: string;

  @Field()
  color: string;

  @Field(() => Int, { nullable: true })
  categoryId: number | null;
}
