import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class MicroserviceStatus {
  @Field(() => String)
  service: string;

  @Field(() => [Int])
  pids: number[];
}
