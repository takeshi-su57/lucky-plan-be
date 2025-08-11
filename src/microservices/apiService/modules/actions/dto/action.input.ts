import { IsNotEmpty, IsString, IsIn, IsNumber, IsJSON } from 'class-validator';

import { eventParsers } from '../eventParsers';
import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';

export class CreateActionInput {
  @IsNotEmpty()
  @IsString()
  @IsIn(eventParsers.map((item) => item.eventName))
  name: string;

  @IsNotEmpty()
  @IsWalletAddress()
  positionAddress: string;

  @IsNotEmpty()
  @IsNumber()
  positionIndex: number;

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
}
