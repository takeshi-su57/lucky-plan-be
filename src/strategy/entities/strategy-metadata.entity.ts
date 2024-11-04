import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class StrategyMetadata {
  @Field()
  key: string;

  @Field()
  title: string;

  @Field()
  description: string;
}
