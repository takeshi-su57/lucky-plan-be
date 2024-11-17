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

  @IsString()
  @IsIn([MissionStatus.Opened, MissionStatus.Closed])
  status?: MissionStatus;
}

export class MissionAttachAchievePositionInput {
  @IsNotEmpty()
  @IsNumber()
  id: number;

  @IsNotEmpty()
  @IsNumber()
  achievePositionId: number;
}

export class MissionCloseInput {
  @IsNotEmpty()
  @IsNumber()
  id: number;
}
