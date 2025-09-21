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
  isReceivedKillProcess = false;
  status: ServiceStatus;

  constructor(
    private solanaChainsService: SolanaChainsService,
    private prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {
    this.status = ServiceStatus.READY;
    this.isReceivedKillProcess = false;
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

      while (true) {
        const solanaConnection =
          await this.solanaChainsService.getAvailableConnection();

        const confirmedSignatureInfos =
          await solanaConnection.connection.getSignaturesForAddress(
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

        const successSignatures = confirmedSignatureInfos.filter(
          ({ err }) => err === null,
        );

        for (const signature of successSignatures.reverse()) {
          const freeConnection =
            await this.solanaChainsService.getAvailableConnection();

          const txs = await freeConnection.connection.getTransactions(
            [signature.signature],
            {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            },
          );

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
              signature: signature.signature,
              slot: event.slot ?? 0,
              date: new Date((event.blockTime ?? 0) * 1000),
              jsonLog: JSON.stringify(event.event ?? {}),
            })),
          });

          await this.prismaService.metadata.upsert({
            where: {
              key: JUP_PERP_LAST_SIGNATURE_KEY,
            },
            update: {
              value: signature.signature,
            },
            create: {
              key: JUP_PERP_LAST_SIGNATURE_KEY,
              value: signature.signature,
            },
          });
        }

        if (lastSignature === undefined) {
          break;
        }
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
