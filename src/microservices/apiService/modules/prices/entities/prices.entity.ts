import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class GnsPricingRecord {
  @Field(() => Int)
  id: number;

  @Field(() => String)
  pair: string;

  @Field(() => Float)
  price: number;

  @Field(() => Date)
  date: Date;
}
