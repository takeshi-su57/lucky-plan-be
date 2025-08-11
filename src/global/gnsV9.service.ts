import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

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
  GetPendingOrdersReturnType,
  GetTradesPayload,
  GetTradesReturnType,
  GetTradePayload,
  GetTradeReturnType,
  GetCollateralPricePayload,
  GetCollateralPriceReturnType,
} from 'src/microservices/web3Service/platform/gns/v9/types';

import { bigIntSafeJsonStringify, bigIntSafeJsonParse } from 'src/utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { ServiceStatus, TradingVariable } from 'src/types';

import { PrismaService } from './prisma.service';
import {
  TradeCollateral,
  TradePair,
} from 'src/microservices/apiService/modules/contracts/entities/contract.entity';

@Injectable()
export class GnsV9Service {
  private tradingVariable: Record<number, TradingVariable> = {};
  public status: ServiceStatus;

  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private prismaService: PrismaService,
  ) {
    this.status = ServiceStatus.READY;
    this.tradingVariable = {};
  }

  async loadTradingVariables() {
    this.status = ServiceStatus.PROCESS;

    const contracts = await this.prismaService.contract.findMany();

    this.tradingVariable = {};

    for (const contract of contracts) {
      console.log(
        `Started loading trading variable for contract: ${contract.chainId}`,
      );

      this.tradingVariable[contract.id] = await this.getTradingVariable(
        contract.id,
      );

      console.log(
        `Ended loading trading variable for contract: ${contract.chainId}`,
      );
    }

    this.status = ServiceStatus.READY;
  }

  async openTrade(data: OpenTradePayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.GnsV9.OpenTrade, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async updateMaxClosingSlippageP(data: UpdateMaxClosingSlippagePPayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(
          PATTERNS.GnsV9.UpdateMaxClosingSlippageP,
          bigIntSafeJsonStringify(data),
        )
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async closeTradeMarket(data: CloseTradeMarketPayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.GnsV9.CloseTradeMarket, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async cancelOrderAfterTimeout(data: CancelOrderAfterTimeoutPayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(
          PATTERNS.GnsV9.CancelOrderAfterTimeout,
          bigIntSafeJsonStringify(data),
        )
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async updateTp(data: UpdateTpPayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.GnsV9.UpdateTp, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async updateSl(data: UpdateSlPayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.GnsV9.UpdateSl, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async updateLeverage(data: UpdateLeveragePayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.GnsV9.UpdateLeverage, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async increasePositionSize(data: IncreasePositionSizePayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(
          PATTERNS.GnsV9.IncreasePositionSize,
          bigIntSafeJsonStringify(data),
        )
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async decreasePositionSize(data: DecreasePositionSizePayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(
          PATTERNS.GnsV9.DecreasePositionSize,
          bigIntSafeJsonStringify(data),
        )
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async getPendingOrders(data: GetPendingOrdersPayload) {
    return await new Promise<GetPendingOrdersReturnType>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.GnsV9.GetPendingOrders, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) =>
            resolve(bigIntSafeJsonParse<GetPendingOrdersReturnType>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async getTrades(data: GetTradesPayload) {
    return await new Promise<GetTradesReturnType>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.GnsV9.GetTrades, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) =>
            resolve(bigIntSafeJsonParse<GetTradesReturnType>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async getTrade(data: GetTradePayload) {
    return await new Promise<GetTradeReturnType>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.GnsV9.GetTrade, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) =>
            resolve(bigIntSafeJsonParse<GetTradeReturnType>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async getTradingVariable(contractId: number) {
    return await new Promise<TradingVariable>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.GnsV9.GetTradingVariable, contractId)
        .subscribe({
          next: (data) => resolve(bigIntSafeJsonParse<TradingVariable>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async getCollateralPrice(payload: GetCollateralPricePayload) {
    return await new Promise<GetCollateralPriceReturnType>(
      (resolve, reject) => {
        this.redisClient
          .send(
            PATTERNS.GnsV9.GetCollateralPrice,
            bigIntSafeJsonStringify(payload),
          )
          .subscribe({
            next: (data) =>
              resolve(bigIntSafeJsonParse<GetCollateralPriceReturnType>(data)),
            error: (err) => reject(err),
          });
      },
    );
  }

  async getPairPrice(pairIndex: number): Promise<bigint> {
    const charts = await fetch(
      'https://backend-pricing.eu.gains.trade/charts',
    ).then((res) => res.json());

    return BigInt(Math.floor(charts.closes[pairIndex] * 1e10));
  }

  getPair(contractId: number, pairIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error('Failed at getting trading variable');
    }

    return this.tradingVariable[contractId].pairs[pairIndex];
  }

  getPairs(contractId: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error('Failed at getting trading variable');
    }

    return this.tradingVariable[contractId].pairs;
  }

  getPairName(contractId: number, pairIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error('Failed at getting trading variable');
    }

    const pair = this.tradingVariable[contractId].pairs[pairIndex];

    return `${pair?.from}/${pair?.to}`;
  }

  getTradePairs(contractIds: number[]): TradePair[] {
    const pairs: TradePair[] = [];

    for (const contractId of contractIds) {
      if (!this.tradingVariable[contractId]) {
        throw new Error('Failed at getting trading variable');
      }

      pairs.push(
        ...this.tradingVariable[contractId].pairs.map((pair, index) => ({
          contractId,
          pairIndex: index,
          from: pair?.from || '',
          to: pair?.to || '',
          onePercentDepthAboveUsd:
            pair?.depth.onePercentDepthAboveUsd.toString() || '0',
          onePercentDepthBelowUsd:
            pair?.depth.onePercentDepthBelowUsd.toString() || '0',
        })),
      );
    }

    return pairs;
  }

  getCollateral(contractId: number, collateralIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error(`Failed at getting trading variable ${contractId}`);
    }

    if (
      this.tradingVariable[contractId].collaterals.length < collateralIndex ||
      collateralIndex === 0
    ) {
      throw new Error(
        `Invalid collateral index collateralIndex:${collateralIndex}, collateralsLength: ${this.tradingVariable[contractId].collaterals.length}`,
      );
    }

    return this.tradingVariable[contractId].collaterals[collateralIndex - 1];
  }

  getTradeCollaterals(contractId: number): TradeCollateral[] {
    if (!this.tradingVariable[contractId]) {
      throw new Error('Failed at getting trading variable');
    }

    return this.tradingVariable[contractId].collaterals.map(
      (collateral, index) => ({
        collateralIndex: index + 1,
        collateral: collateral.collateral,
        isActive: collateral.isActive,
        precision: collateral.precision.toString(),
        precisionDelta: collateral.precisionDelta.toString(),
      }),
    );
  }
}
