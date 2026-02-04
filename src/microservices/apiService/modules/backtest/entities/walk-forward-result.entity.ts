import {
  ObjectType,
  Field,
  Int,
  Float,
  ID,
  registerEnumType,
} from '@nestjs/graphql';
import { JSONScalar } from 'src/global/global.module';
import { Prisma, WalkForwardStatus } from 'generated/prisma/client';

registerEnumType(WalkForwardStatus, {
  name: 'WalkForwardStatus',
  description: 'Status of a walk-forward result',
});

@ObjectType()
export class WalkForwardResult {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  candidateId: string;

  @Field(() => Int)
  windowIndex: number;

  @Field(() => WalkForwardStatus)
  status: WalkForwardStatus;

  @Field()
  trainStart: Date;

  @Field()
  trainEnd: Date;

  @Field(() => JSONScalar, { nullable: true })
  trainMetrics?: Prisma.JsonValue | null;

  @Field()
  testStart: Date;

  @Field()
  testEnd: Date;

  @Field(() => JSONScalar, { nullable: true })
  testMetrics?: Prisma.JsonValue | null;

  @Field(() => Float, { nullable: true })
  consistency?: number | null;

  @Field(() => Float, { nullable: true })
  degradation?: number | null;

  @Field(() => String, { nullable: true })
  errorMessage?: string | null;

  @Field()
  createdAt: Date;
}
