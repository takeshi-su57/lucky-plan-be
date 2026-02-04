import {
  ObjectType,
  Field,
  Int,
  Float,
  ID,
  registerEnumType,
} from '@nestjs/graphql';
import { JSONScalar } from 'src/global/global.module';
import { Prisma, RobustnessTestStatus } from 'generated/prisma/client';

registerEnumType(RobustnessTestStatus, {
  name: 'RobustnessTestStatus',
  description: 'Status of a robustness test',
});

@ObjectType()
export class RobustnessTest {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  candidateId: string;

  @Field(() => Int)
  stepIndex: number;

  @Field(() => RobustnessTestStatus)
  status: RobustnessTestStatus;

  @Field()
  startDate: Date;

  @Field()
  endDate: Date;

  @Field(() => JSONScalar, { nullable: true })
  metrics?: Prisma.JsonValue | null;

  @Field(() => Float, { nullable: true })
  sharpeRatio?: number | null;

  @Field(() => Float, { nullable: true })
  totalPnl?: number | null;

  @Field(() => Float, { nullable: true })
  maxDrawdown?: number | null;

  @Field(() => String, { nullable: true })
  errorMessage?: string | null;

  @Field()
  createdAt: Date;
}
