import { TaskStatus } from '@prisma/client';
import { IsArray, IsIn, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class TaskCreateInput {
  @IsNotEmpty()
  @IsNumber()
  missionId: number;

  @IsNotEmpty()
  @IsNumber()
  actionId: number;

  @IsNotEmpty()
  @IsString()
  @IsIn([
    TaskStatus.Created,
    TaskStatus.Await,
    TaskStatus.Initiated,
    TaskStatus.Failed,
    TaskStatus.Stopped,
    TaskStatus.Completed,
  ])
  status: TaskStatus;

  @IsNotEmpty()
  @IsArray()
  logs: string[];
}

export class TaskUpdateInput {
  @IsNotEmpty()
  @IsNumber()
  id: number;

  @IsNotEmpty()
  @IsString()
  @IsIn([
    TaskStatus.Created,
    TaskStatus.Await,
    TaskStatus.Initiated,
    TaskStatus.Failed,
    TaskStatus.Stopped,
    TaskStatus.Completed,
  ])
  status: TaskStatus;

  @IsNotEmpty()
  @IsArray()
  logs: string[];
}
