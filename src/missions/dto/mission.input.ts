import { MissionStatus } from '@prisma/client';
import { IsIn, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class MissionCreateInput {
  @IsNotEmpty()
  @IsNumber()
  botId: number;

  @IsNotEmpty()
  @IsNumber()
  targetPositionId: number;
}

export class MissionUpdateInput {
  @IsNotEmpty()
  @IsNumber()
  id: number;

  @IsNumber()
  achievePositionId?: number;

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
