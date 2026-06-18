import { IsNotEmpty, IsString, IsIn, IsNumber, IsJSON } from 'class-validator';
import { ActionOrigin } from 'generated/prisma/client';

import { eventParsers } from '../../../../../web3/platform/gns/v10/eventParsers';

export class CreateActionInput {
  contractId?: number;

  origin?: ActionOrigin;

  @IsNotEmpty()
  @IsString()
  @IsIn(eventParsers.map((item) => item.eventName))
  name: string;

  @IsNotEmpty()
  @IsString()
  positionKey: string;

  @IsNotEmpty()
  @IsString()
  address: string;

  @IsNotEmpty()
  @IsString()
  @IsJSON()
  args: string;

  @IsNotEmpty()
  @IsNumber()
  blockNumber: number;

  @IsNotEmpty()
  @IsNumber()
  orderInBlock: number;

  blockHash?: string;

  txHash?: string;

  dedupeKey?: string;
}
