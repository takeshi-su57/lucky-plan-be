import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class Strategy {
  @Field(() => Int)
  id: number;

  @Field()
  strategyKey: string;

  @Field()
  params: string;
}
