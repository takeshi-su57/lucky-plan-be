import { Injectable } from '@nestjs/common';

import { ClientService } from './client.service';

import { ContractEventLog } from './contract-monitor.service';

@Injectable()
export class TradeService {
  readonly registeredEvents: string[];
  private accEventsByChains: Record<number, number>;

  constructor(private clientService: ClientService) {
    this.registeredEvents = [
      'TradeSlUpdated',
      'TradeTpUpdated',
      'PositionSizeDecreaseExecuted',
      'PositionSizeIncreaseExecuted',
      'LeverageUpdateExecuted',
      'MarketExecuted',
    ];

    this.accEventsByChains = {};
  }

  handleLogs(chainId: number, eventLogs: ContractEventLog[]) {
    const filteredEvents = eventLogs.filter((log) =>
      this.registeredEvents.includes(log.eventName),
    );

    if (this.accEventsByChains[chainId]) {
      this.accEventsByChains[chainId] =
        this.accEventsByChains[chainId] + filteredEvents.length;
    } else {
      this.accEventsByChains[chainId] = filteredEvents.length;
    }

    console.log(chainId, eventLogs.length, filteredEvents);
    console.log('Accumulated ==>', this.accEventsByChains[chainId]);
  }
}
