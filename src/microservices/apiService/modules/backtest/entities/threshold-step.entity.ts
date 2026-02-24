import { ObjectType, Field, Int, Float, ID } from '@nestjs/graphql';

@ObjectType()
export class ThresholdStep {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  pipelineId: string;

  @Field(() => Int)
  stepOrder: number;

  @Field()
  metricName: string;

  @Field()
  operator: string;

  @Field(() => Float)
  value: number;

  @Field(() => Int)
  candidatesBefore: number;

  @Field(() => Int)
  candidatesAfter: number;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class ThresholdPreviewResult {
  @Field(() => Int)
  currentCount: number;

  @Field(() => Int)
  survivingCount: number;

  @Field(() => Int)
  eliminatedCount: number;
}
