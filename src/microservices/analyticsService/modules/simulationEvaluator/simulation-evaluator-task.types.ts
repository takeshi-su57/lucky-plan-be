import {
  Platform,
  SimulationEvaluatorTaskKind,
  SimulationEvaluatorTaskStatus,
} from 'generated/prisma/enums';

export type CreateSimulationEvaluatorTaskInput = {
  kind: SimulationEvaluatorTaskKind;
  simulationId?: number;
  simulationPlanId?: number;
  platform?: Platform;
  targetWorkerId?: string;
  requiredCacheStartAt?: Date;
  requiredCacheEndAt?: Date;
  rangeStartedAt: Date;
  rangeEndedAt: Date;
  input: Record<string, unknown>;
};

export type ClaimedSimulationEvaluatorTask = {
  id: string;
  kind: SimulationEvaluatorTaskKind;
  simulationId: number | null;
  simulationPlanId: number | null;
  rangeStartedAt: Date;
  rangeEndedAt: Date;
  input: Record<string, unknown>;
  inputChecksum: string;
  leaseToken: string;
  leaseExpiresAt: Date;
};

export type CompleteSimulationEvaluatorTaskInput = {
  taskId: string;
  workerId: string;
  leaseToken: string;
  result: Record<string, unknown>;
};

export { SimulationEvaluatorTaskKind, SimulationEvaluatorTaskStatus };
