import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class Mission {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  botId: number;

  @Field(() => Int)
  targetPositionId: number;

  @Field(() => Int, { nullable: true })
  achievePositionId: number | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}
