import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class SLTPRequest {
  @Field(() => Int)
  id: number;

  @Field(() => String)
  address: string;

  @Field(() => Int)
  contractId: number;

  @Field(() => String)
  positionKey: string;

  @Field(() => String)
  condition: string;

  @Field(() => Date)
  createdAt: Date;
}
