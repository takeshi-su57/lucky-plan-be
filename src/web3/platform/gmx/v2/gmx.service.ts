import { Injectable } from '@nestjs/common';

import { gmxMarketConfigs } from './configs/marketConfigs';
import { gmxTokenConfigs } from './configs/tokenConfigs';
import { MarketConfig } from './types';

@Injectable()
export class GmxService {
  marketMap: Record<string, MarketConfig> = {};

  constructor() {
    for (const [chainId, markets] of Object.entries(gmxMarketConfigs)) {
      for (const [market, marketConfig] of Object.entries(markets)) {
        this.marketMap[`${chainId}-${market}`.toLowerCase()] = marketConfig;
      }
    }
  }

  getMarketInfo(chainId: number, market: string) {
    return this.marketMap[`${chainId}-${market}`.toLowerCase()];
  }

  getTokenInfo(chainId: number, token: string) {
    return gmxTokenConfigs[chainId][token.toLowerCase()];
  }
}
