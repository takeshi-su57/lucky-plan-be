import { ObjectType, Field, Int, ID } from '@nestjs/graphql';

@ObjectType()
export class ParetoStep {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  pipelineId: string;

  @Field(() => Int)
  stepOrder: number;

  @Field(() => [String])
  metrics: string[];

  @Field(() => Int)
  candidatesBefore: number;

  @Field(() => Int)
  candidatesAfter: number;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class ParetoPreviewResult {
  @Field(() => Int)
  currentCount: number;

  @Field(() => Int)
  optimalCount: number;

  @Field(() => Int)
  dominatedCount: number;
}
