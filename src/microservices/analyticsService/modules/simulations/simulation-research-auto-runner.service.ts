import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationResearch } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';

@Injectable()
export class SimulationResearchAutoRunnerService {
  constructor(private readonly prisma: PrismaService) {}

  async playQueuedResearch(id: number): Promise<SimulationResearch | null> {
    const research = await this.prisma.simulationResearch.findUnique({
      where: { id },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });

    return research as unknown as SimulationResearch | null;
  }
}
