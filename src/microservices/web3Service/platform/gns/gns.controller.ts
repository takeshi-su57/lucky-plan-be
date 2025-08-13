import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { GnsService } from './gns.service';
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
} from './v10/types';

@Controller()
export class GnsController {
  constructor(private readonly gnsService: GnsService) {}

  @MessagePattern(PATTERNS.Gns.OpenTrade)
  async openTrade(
    @Payload()
    data: string,
  ) {
    return await this.gnsService.openTrade(
      bigIntSafeJsonParse<OpenTradePayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.UpdateMaxClosingSlippageP)
  async updateMaxClosingSlippageP(
    @Payload()
    data: string,
  ) {
    return await this.gnsService.updateMaxClosingSlippageP(
      bigIntSafeJsonParse<UpdateMaxClosingSlippagePPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.CloseTradeMarket)
  async closeTradeMarket(
    @Payload()
    data: string,
  ) {
    return await this.gnsService.closeTradeMarket(
      bigIntSafeJsonParse<CloseTradeMarketPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.CancelOrderAfterTimeout)
  async cancelOrderAfterTimeout(
    @Payload()
    data: string,
  ) {
    return await this.gnsService.cancelOrderAfterTimeout(
      bigIntSafeJsonParse<CancelOrderAfterTimeoutPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.UpdateTp)
  async updateTp(
    @Payload()
    data: string,
  ) {
    return await this.gnsService.updateTp(
      bigIntSafeJsonParse<UpdateTpPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.UpdateSl)
  async updateSl(
    @Payload()
    data: string,
  ) {
    return await this.gnsService.updateSl(
      bigIntSafeJsonParse<UpdateSlPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.UpdateLeverage)
  async updateLeverage(
    @Payload()
    data: string,
  ) {
    return await this.gnsService.updateLeverage(
      bigIntSafeJsonParse<UpdateLeveragePayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.IncreasePositionSize)
  async increasePositionSize(
    @Payload()
    data: string,
  ) {
    return await this.gnsService.increasePositionSize(
      bigIntSafeJsonParse<IncreasePositionSizePayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.DecreasePositionSize)
  async decreasePositionSize(
    @Payload()
    data: string,
  ) {
    return await this.gnsService.decreasePositionSize(
      bigIntSafeJsonParse<DecreasePositionSizePayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.V10.WithdrawPositivePnl)
  async withdrawPositivePnl(
    @Payload()
    data: string,
  ) {
    return await this.gnsService.withdrawPositivePnl(
      bigIntSafeJsonParse<WithdrawPositivePnlPayload>(data),
    );
  }

  @MessagePattern(PATTERNS.Gns.GetPendingOrders)
  async getPendingOrders(
    @Payload()
    data: string,
  ) {
    return bigIntSafeJsonStringify(
      await this.gnsService.getPendingOrders(
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
      await this.gnsService.getTrades(
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
      await this.gnsService.getTrade(
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
      await this.gnsService.getTradingVariable(contractId),
    );
  }

  @MessagePattern(PATTERNS.Gns.GetCollateralPrice)
  async getCollateralPrice(
    @Payload()
    data: string,
  ) {
    return bigIntSafeJsonStringify(
      await this.gnsService.getCollateralPrice(
        bigIntSafeJsonParse<GetCollateralPricePayload>(data),
      ),
    );
  }
}
