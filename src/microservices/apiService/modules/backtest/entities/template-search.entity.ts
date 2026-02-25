import { ObjectType, Field, Int, registerEnumType, ID } from '@nestjs/graphql';
import { TemplateSearchStatus } from 'generated/prisma/client';

import { StrategyTemplate } from './strategy-template.entity';
import { BacktestTask } from './backtest-task.entity';

registerEnumType(TemplateSearchStatus, {
  name: 'TemplateSearchStatus',
  description: 'Status of a template search',
});

@ObjectType()
export class TemplateSearch {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => ID)
  templateId: string;

  @Field({ description: 'Symbol to run backtest on' })
  symbol: string;

  @Field()
  startDate: Date;

  @Field()
  endDate: Date;

  @Field({ defaultValue: '1m' })
  interval: string;

  @Field({ defaultValue: 'optuna' })
  searchStrategy: string;

  @Field(() => TemplateSearchStatus)
  status: TemplateSearchStatus;

  @Field()
  createdAt: Date;

  @Field(() => Date, { nullable: true })
  startedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  completedAt?: Date | null;

  @Field(() => String, { nullable: true })
  errorMessage?: string | null;
}

@ObjectType()
export class TemplateSearchWithTemplate extends TemplateSearch {
  @Field(() => StrategyTemplate)
  template: StrategyTemplate;
}

@ObjectType()
export class TemplateSearchWithTask extends TemplateSearch {
  @Field(() => StrategyTemplate)
  template: StrategyTemplate;

  @Field(() => BacktestTask, { nullable: true })
  task?: BacktestTask | null;
}

@ObjectType()
export class TemplateSearchStats {
  @Field(() => Int)
  await: number;

  @Field(() => Int)
  processing: number;

  @Field(() => Int)
  done: number;

  @Field(() => Int)
  failed: number;

  @Field(() => Int)
  cancelled: number;
}
