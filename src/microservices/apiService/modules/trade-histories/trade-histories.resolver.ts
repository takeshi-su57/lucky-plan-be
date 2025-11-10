import { Resolver, Query, Args, Int } from '@nestjs/graphql';

import {
  TradeHistory,
  TradeTransactionCount,
} from './entities/trade-history.entity';
import { GetUserTransactionCountsInput } from './dto/trade-history.input';

import { TradeHistoriesService } from './trade-histories.service';

@Resolver(() => TradeHistory)
export class TradeHistoriesResolver {
  constructor(private readonly tradeHistoriesService: TradeHistoriesService) {}

  @Query(() => TradeTransactionCount)
  getTradeTransactionCounts(
    @Args('contractIds', { type: () => [Int] }) contractIds: number[],
    @Args('addresses', { type: () => [String] }) addresses: string[],
  ) {
    return this.tradeHistoriesService.getTradeTransactionCounts(
      contractIds,
      addresses,
    );
  }

  @Query(() => [TradeTransactionCount])
  getUserTransactionCounts(
    @Args('inputs', { type: () => [GetUserTransactionCountsInput] })
    inputs: GetUserTransactionCountsInput[],
  ) {
    return this.tradeHistoriesService.getUserTransactionCounts(inputs);
  }

  @Query(() => [TradeHistory])
  getTradeHistories(
    @Args('address') address: string,
    @Args('contractId', { type: () => Int })
    contractId: number,
  ) {
    return this.tradeHistoriesService.getTradeHistories([address], contractId);
  }
}
