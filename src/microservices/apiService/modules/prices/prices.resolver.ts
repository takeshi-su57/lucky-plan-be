import { UseGuards } from '@nestjs/common';
import { Resolver, Query, Args } from '@nestjs/graphql';
import { UserPermission } from 'generated/prisma/client';

import { GnsPricingRecord } from './entities/prices.entity';
import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';

import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { PricesService } from './prices.service';

@Resolver()
export class PricesResolver {
  constructor(private readonly pricesService: PricesService) {}

  @Query(() => [GnsPricingRecord])
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getGnsPrices(
    @Args('pairName', { type: () => String }) pairName: string,
    @Args('fromDate', { type: () => Date }) fromDate: Date,
    @Args('toDate', { type: () => Date }) toDate: Date,
  ) {
    return this.pricesService.getGnsPrices(
      pairName,
      new Date(fromDate),
      new Date(toDate),
    );
  }
}
