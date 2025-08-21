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
  TradingVariable,
  WithdrawPositivePnlPayload,
} from 'src/microservices/web3Service/platform/gns/v10/types';

import { bigIntSafeJsonStringify, bigIntSafeJsonParse } from 'src/utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { ServiceStatus } from 'src/types';

import { PrismaService } from './prisma.service';
import {
  TradeCollateral,
  TradePair,
} from 'src/microservices/apiService/modules/contracts/entities/contract.entity';
import { timeout } from 'rxjs';
import { Platform } from '@prisma/client';

@Injectable()
export class GnsService {
  private tradingVariable: Record<number, TradingVariable> = {};
  public status: ServiceStatus;

  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private prismaService: PrismaService,
  ) {
    this.status = ServiceStatus.KILLED;
    this.tradingVariable = {};
  }

  async loadTradingVariables() {
    this.status = ServiceStatus.PROCESS;

    const contracts = await this.prismaService.contract.findMany({
      where: { platform: Platform.GNS },
    });

    this.tradingVariable = {};

    for (const contract of contracts) {
      this.tradingVariable[contract.id] = await this.getTradingVariable(
        contract.id,
      );
    }

    this.status = ServiceStatus.READY;
  }

  async openTrade(data: OpenTradePayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Gns.OpenTrade, bigIntSafeJsonStringify(data))
        .pipe(timeout(120_000))
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
          PATTERNS.Gns.UpdateMaxClosingSlippageP,
          bigIntSafeJsonStringify(data),
        )
        .pipe(timeout(120_000))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async closeTradeMarket(data: CloseTradeMarketPayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Gns.CloseTradeMarket, bigIntSafeJsonStringify(data))
        .pipe(timeout(120_000))
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
          PATTERNS.Gns.CancelOrderAfterTimeout,
          bigIntSafeJsonStringify(data),
        )
        .pipe(timeout(120_000))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async updateTp(data: UpdateTpPayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Gns.UpdateTp, bigIntSafeJsonStringify(data))
        .pipe(timeout(120_000))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async updateSl(data: UpdateSlPayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Gns.UpdateSl, bigIntSafeJsonStringify(data))
        .pipe(timeout(120_000))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async updateLeverage(data: UpdateLeveragePayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Gns.UpdateLeverage, bigIntSafeJsonStringify(data))
        .pipe(timeout(120_000))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async increasePositionSize(data: IncreasePositionSizePayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Gns.IncreasePositionSize, bigIntSafeJsonStringify(data))
        .pipe(timeout(120_000))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async decreasePositionSize(data: DecreasePositionSizePayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Gns.DecreasePositionSize, bigIntSafeJsonStringify(data))
        .pipe(timeout(120_000))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async withdrawPositivePnl(data: WithdrawPositivePnlPayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(
          PATTERNS.Gns.V10.WithdrawPositivePnl,
          bigIntSafeJsonStringify(data),
        )
        .pipe(timeout(120_000))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async getPendingOrders(data: GetPendingOrdersPayload) {
    return await new Promise<GetPendingOrdersReturnType>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Gns.GetPendingOrders, bigIntSafeJsonStringify(data))
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
        .send(PATTERNS.Gns.GetTrades, bigIntSafeJsonStringify(data))
        .pipe(timeout(120_000))
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
        .send(PATTERNS.Gns.GetTrade, bigIntSafeJsonStringify(data))
        .pipe(timeout(120_000))
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
        .send(PATTERNS.Gns.GetTradingVariable, contractId)
        .pipe(timeout(120_000))
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
            PATTERNS.Gns.GetCollateralPrice,
            bigIntSafeJsonStringify(payload),
          )
          .pipe(timeout(120_000))
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
