import { MissionMode, MissionStatus } from '@prisma/client';
import { IsIn, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class MissionCreateInput {
  @IsNotEmpty()
  @IsNumber()
  botId: number;

  @IsNotEmpty()
  @IsString()
  targetPositionKey: string;

  @IsNotEmpty()
  @IsNumber()
  targetPositionBlockNumber: number;

  @IsNotEmpty()
  @IsNumber()
  targetPositionLogIndex: number;

  @IsNotEmpty()
  mode: MissionMode;
}

export class MissionUpdateInput {
  @IsNotEmpty()
  @IsNumber()
  id: number;

  @IsNumber()
  achievePositionKey?: string | null;

  @IsNumber()
  achievePositionBlockNumber?: number | null;

  @IsNumber()
  achievePositionLogIndex?: number | null;

  @IsNotEmpty()
  @IsString()
  @IsIn([
    MissionStatus.Created,
    MissionStatus.Opening,
    MissionStatus.Opened,
    MissionStatus.Closing,
    MissionStatus.Closed,
    MissionStatus.Ignored,
  ])
  status: MissionStatus;
}

export class MissionCloseInput {
  @IsNotEmpty()
  @IsNumber()
  id: number;
}
