import { Injectable } from '@nestjs/common';

import { getReadableError } from 'src/utils';
import { LogsService } from 'src/global/logs.service';
import { ServiceStatus } from 'src/types';
import { SolanaChainsService } from 'src/web3/web3/solana-chains.service';

import { PrismaService } from 'src/global/prisma.service';
import {
  JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY,
  JUPITER_PERPETUALS_PROGRAM,
} from 'src/web3/platform/jup/anchor/constants';
import { DISCRIMINATOR_SIZE, utils } from '@coral-xyz/anchor';

const JUP_PERP_LAST_SIGNATURE_KEY = 'jup_perp_last_signature';

@Injectable()
export class JupPerpEventLoggerService {
  status: ServiceStatus;

  constructor(
    private solanaChainsService: SolanaChainsService,
    private prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {
    this.status = ServiceStatus.READY;
  }

  async pullEventsFromSolana() {
    this.status = ServiceStatus.PROCESS;

    try {
      const lastSignatureEntity = await this.prismaService.metadata.findUnique({
        where: {
          key: JUP_PERP_LAST_SIGNATURE_KEY,
        },
      });

      const lastSignature = lastSignatureEntity
        ? lastSignatureEntity.value
        : undefined;

      let beforeSignature: string | undefined = undefined;

      const successSignatures: string[] = [];

      while (true) {
        const confirmedSignatureInfos =
          await this.solanaChainsService.getSignaturesForAddress(
            JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY,
            {
              before: beforeSignature,
              until: lastSignature,
            },
          );

        if (confirmedSignatureInfos.length === 0) {
          break;
        }

        beforeSignature =
          confirmedSignatureInfos[confirmedSignatureInfos.length - 1].signature;

        successSignatures.push(
          ...confirmedSignatureInfos
            .filter(({ err }) => err === null)
            .map(({ signature }) => signature),
        );

        if (lastSignature === undefined) {
          break;
        }
      }

      for (const signature of successSignatures.reverse()) {
        const exists = await this.prismaService.jupPerpEventLog.findMany({
          where: {
            signature,
          },
        });

        if (exists.length === 0) {
          const txs = await this.solanaChainsService.getTransactions([
            signature,
          ]);

          const allEvents = txs
            .flatMap((tx) => {
              return tx?.meta?.innerInstructions?.flatMap((ix) => {
                return ix.instructions.map((iix) => {
                  const ixData = utils.bytes.bs58.decode(iix.data);

                  const eventData = utils.bytes.base64.encode(
                    ixData.subarray(DISCRIMINATOR_SIZE),
                  );
                  const event =
                    JUPITER_PERPETUALS_PROGRAM.coder.events.decode(eventData);

                  return {
                    event,
                    slot: tx.slot,
                    blockTime: tx.blockTime,
                  };
                });
              });
            })
            .filter((item) => !!item)
            .filter((item) => !!item.event);

          await this.prismaService.jupPerpEventLog.createMany({
            data: allEvents.map((event) => ({
              signature,
              slot: event.slot ?? 0,
              date: new Date((event.blockTime ?? 0) * 1000),
              jsonLog: JSON.stringify(event.event ?? {}),
            })),
          });
        }

        await this.prismaService.metadata.upsert({
          where: {
            key: JUP_PERP_LAST_SIGNATURE_KEY,
          },
          update: {
            value: signature,
          },
          create: {
            key: JUP_PERP_LAST_SIGNATURE_KEY,
            value: signature,
          },
        });
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Critical',
        summary: 'jup-perp-event-logger>pullEventsFromSolana',
        details: `${getReadableError(err)}`,
      });
    }

    this.status = ServiceStatus.READY;
  }
}
