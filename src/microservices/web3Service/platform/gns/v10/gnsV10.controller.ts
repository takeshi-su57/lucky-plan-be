import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { GnsV10Service } from './gnsV10.service';
import { PATTERNS } from 'src/utils/constants';
import { bigIntSafeJsonParse, bigIntSafeJsonStringify } from 'src/utils';
import {
  OpenTradePayload,
  UpdateMaxClosingSlippagePPayload,
  CloseTradeMarketPayload,
  CancelOrderAfterTimeoutPayload,
  UpdateTpPayload,
  UpdateSlPayload,
  UpdateLeveragePayload,
  IncreasePositionSizePayload,
  DecreasePositionSizePayload,
  GetPendingOrdersPayload,
  GetTradesPayload,
  GetTradePayload,
  GetCollateralPricePayload,
  WithdrawPositivePnlPayload,
} from './types';

@Controller()
export class GnsV10Controller {
  constructor(private readonly gnsV10Service: GnsV10Service) {}

  @MessagePattern(PATTERNS.Gns.OpenTrade)
  async openTrade(
    @Payload()
    data: string,
  ) {
    return await this.gnsV10Service.openTrade(
      bigIntSafeJsonParse<OpenTradePayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.UpdateMaxClosingSlippageP)
  async updateMaxClosingSlippageP(
    @Payload()
    data: string,
  ) {
    return await this.gnsV10Service.updateMaxClosingSlippageP(
      bigIntSafeJsonParse<UpdateMaxClosingSlippagePPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.CloseTradeMarket)
  async closeTradeMarket(
    @Payload()
    data: string,
  ) {
    return await this.gnsV10Service.closeTradeMarket(
      bigIntSafeJsonParse<CloseTradeMarketPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.CancelOrderAfterTimeout)
  async cancelOrderAfterTimeout(
    @Payload()
    data: string,
  ) {
    return await this.gnsV10Service.cancelOrderAfterTimeout(
      bigIntSafeJsonParse<CancelOrderAfterTimeoutPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.UpdateTp)
  async updateTp(
    @Payload()
    data: string,
  ) {
    return await this.gnsV10Service.updateTp(
      bigIntSafeJsonParse<UpdateTpPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.UpdateSl)
  async updateSl(
    @Payload()
    data: string,
  ) {
    return await this.gnsV10Service.updateSl(
      bigIntSafeJsonParse<UpdateSlPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.UpdateLeverage)
  async updateLeverage(
    @Payload()
    data: string,
  ) {
    return await this.gnsV10Service.updateLeverage(
      bigIntSafeJsonParse<UpdateLeveragePayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.IncreasePositionSize)
  async increasePositionSize(
    @Payload()
    data: string,
  ) {
    return await this.gnsV10Service.increasePositionSize(
      bigIntSafeJsonParse<IncreasePositionSizePayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.DecreasePositionSize)
  async decreasePositionSize(
    @Payload()
    data: string,
  ) {
    return await this.gnsV10Service.decreasePositionSize(
      bigIntSafeJsonParse<DecreasePositionSizePayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.V10.WithdrawPositivePnl)
  async withdrawPositivePnl(
    @Payload()
    data: string,
  ) {
    return await this.gnsV10Service.withdrawPositivePnl(
      bigIntSafeJsonParse<WithdrawPositivePnlPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.GetPendingOrders)
  async getPendingOrders(
    @Payload()
    data: string,
  ) {
    return bigIntSafeJsonStringify(
      await this.gnsV10Service.getPendingOrders(
        bigIntSafeJsonParse<GetPendingOrdersPayload>(data),
      ),
    );
  }

  @MessagePattern(PATTERNS.Gns.GetTrades)
  async getTrades(
    @Payload()
    data: string,
  ) {
    return bigIntSafeJsonStringify(
      await this.gnsV10Service.getTrades(
        bigIntSafeJsonParse<GetTradesPayload>(data),
      ),
    );
  }

  @MessagePattern(PATTERNS.Gns.GetTrade)
  async getTrade(
    @Payload()
    data: string,
  ) {
    return bigIntSafeJsonStringify(
      await this.gnsV10Service.getTrade(
        bigIntSafeJsonParse<GetTradePayload>(data),
      ),
    );
  }

  @MessagePattern(PATTERNS.Gns.GetTradingVariable)
  async getTradingVariable(
    @Payload()
    contractId: number,
  ) {
    return bigIntSafeJsonStringify(
      await this.gnsV10Service.getTradingVariable(contractId),
    );
  }

  @MessagePattern(PATTERNS.Gns.GetCollateralPrice)
  async getCollateralPrice(
    @Payload()
    data: string,
  ) {
    return bigIntSafeJsonStringify(
      await this.gnsV10Service.getCollateralPrice(
        bigIntSafeJsonParse<GetCollateralPricePayload>(data),
      ),
    );
  }
}
