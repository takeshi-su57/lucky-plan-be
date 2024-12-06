import { Cron, CronExpression } from '@nestjs/schedule';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { validateMnemonic } from '@scure/bip39';
import { Address, english, mnemonicToAccount } from 'viem/accounts';
import { erc20Abi } from 'viem';
import { PubSub } from 'graphql-subscriptions';

import { PUB_SUB } from 'src/global/global.module';
import { PrismaService } from 'src/global/prisma.service';
import { UsersService } from 'src/users/users.service';
import { ContractsService } from 'src/contracts/contracts.service';
import { getReadableError } from 'src/utils';

import { ChainsService } from 'src/global/chains.service';
import { Contract } from 'src/contracts/entities/contract.entity';
import { TradingVariableService } from 'src/global/trading-variable.service';
import { SUBSCRIPTION_TOKEN, USDCCollateralIndex } from 'src/utils/constants';

@Injectable()
export class FollowerService {
  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private prismaService: PrismaService,
    private usersService: UsersService,
    private contractService: ContractsService,
    private chainsService: ChainsService,
    private tradingVariableServcie: TradingVariableService,
    private logger: Logger,
  ) {}

  async moveAsset({
    address,
    contract,
    amount,
    kind,
  }: {
    address: string;
    contract: Contract;
    amount: bigint;
    kind: 'usdcDeposit' | 'usdcWithdraw' | 'ethDeposit' | 'ethWithdraw';
  }) {
    try {
      const masterFollower = await this.prismaService.follower.findUnique({
        where: {
          accountIndex: 1,
        },
      });

      const follower = await this.prismaService.follower.findUnique({
        where: {
          address,
        },
      });

      if (!follower || !masterFollower) {
        throw new Error('Wrong address');
      }

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const collateralInfo = this.tradingVariableServcie.getCollateral(
        contract.chainId,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const followerWallet = this.chainsService.walletClient(
        contract.chainId,
        follower,
      );

      const masterWallet = this.chainsService.walletClient(
        contract.chainId,
        masterFollower,
      );

      switch (kind) {
        case 'usdcWithdraw': {
          this.logger.log(
            `FollowerService>moveAsset>: Move ${amount / 1000000n} USDC from ${follower.address} to ${masterFollower.address}`,
          );

          const { request } = await publicClient.simulateContract({
            account: followerWallet.account,
            address: collateralInfo.collateral,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [masterFollower.address as Address, amount],
          });

          return await followerWallet.writeContract(request);
        }
        case 'usdcDeposit': {
          this.logger.log(
            `FollowerService>moveAsset>: Move ${amount / 1000000n} USDC from ${masterFollower.address} to ${follower.address}`,
          );

          const { request } = await publicClient.simulateContract({
            account: masterWallet.account,
            address: collateralInfo.collateral,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [follower.address as Address, amount],
          });

          return await masterWallet.writeContract(request);
        }
        case 'ethWithdraw': {
          this.logger.log(
            `FollowerService>moveAsset>: Move ${amount / 1000000000n} gwei from ${follower.address} to ${masterFollower.address}`,
          );

          return await followerWallet.sendTransaction({
            account: followerWallet.account!,
            to: masterFollower.address as Address,
            value: amount,
            chain: followerWallet.chain,
          });
        }
        case 'ethDeposit': {
          this.logger.log(
            `FollowerService>moveAsset>: Move ${amount / 1000000000n} gwei from ${masterFollower.address} to ${follower.address}`,
          );

          return await masterWallet.sendTransaction({
            account: masterWallet.account!,
            to: follower.address as Address,
            value: amount,
            chain: masterWallet.chain,
          });
        }
      }
    } catch (err) {
      this.logger.error(`FollowerService>moveAsset>: ${getReadableError(err)}`);
    }
  }

  async withdrawAll(address: string, contractId: number): Promise<boolean> {
    try {
      const contract = await this.contractService.findOne(contractId);

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const collateralInfo = this.tradingVariableServcie.getCollateral(
        contractId,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const usdcBalance = await publicClient.readContract({
        address: collateralInfo.collateral,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as Address],
      });

      await this.moveAsset({
        address,
        contract: contract,
        amount: usdcBalance,
        kind: 'usdcWithdraw',
      });

      const ethBalance = await publicClient.getBalance({
        address: address as Address,
      });

      await this.moveAsset({
        address,
        contract: contract,
        amount: ethBalance,
        kind: 'ethWithdraw',
      });

      return true;
    } catch (err) {
      this.logger.error(
        `FollowerService>withdrawAll>: ${getReadableError(err)}`,
      );
    }

    return false;
  }

  async getPrivateKey(address: string) {
    const mnemonicMetadata = await this.prismaService.metadata.findUnique({
      where: {
        key: this.prismaService.metadataKeys.mnemonic.key,
      },
    });

    const mnemonic = mnemonicMetadata?.value || '';

    if (!validateMnemonic(mnemonic, english)) {
      throw new Error('Wrong mnemonic, plz check seed the db metadata');
    }

    const record = await this.prismaService.follower.findUnique({
      where: { address },
    });

    if (!record) {
      throw new Error('Wrong address');
    }

    const account = mnemonicToAccount(mnemonic, {
      accountIndex: record.accountIndex,
    });

    return `0x${Array.from(account.getHdKey().privateKey!)
      .map((byte) => byte.toString(16).padStart(2, '0')) // Convert each byte to hex
      .join('')}`;
  }

  async generateNewFollower() {
    const mnemonicMetadata = await this.prismaService.metadata.findUnique({
      where: {
        key: this.prismaService.metadataKeys.mnemonic.key,
      },
    });

    const mnemonic = mnemonicMetadata?.value || '';

    if (!validateMnemonic(mnemonic, english)) {
      throw new Error('Wrong mnemonic, plz check seed the db metadata');
    }

    for (let accountIndex = 1; ; accountIndex++) {
      const account = mnemonicToAccount(mnemonic, {
        accountIndex,
      });

      const followerRecord = await this.prismaService.follower.findUnique({
        where: {
          address: account.address.toLowerCase(),
        },
      });

      // find new account
      if (!followerRecord) {
        const user = await this.usersService.getUserByAddress(
          account.address.toLowerCase(),
        );

        if (!user) {
          await this.usersService.addUser(account.address.toLowerCase());
        }

        return await this.prismaService.follower.create({
          data: {
            address: account.address.toLowerCase(),
            publicKey: account.publicKey,
            accountIndex,
          },
        });
      }
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async followerAssetBalanceUpdateCron() {
    try {
      const contracts = await this.contractService.findAll();

      for (const contract of contracts) {
        const updatedFollowers = await this.loadFollowers(contract.id);

        this.pubSub.publish(SUBSCRIPTION_TOKEN.followerDetailsUpdated, {
          [SUBSCRIPTION_TOKEN.followerDetailsUpdated]: updatedFollowers,
        });
      }
    } catch (err) {
      this.logger.error(
        `FollowerService>followerAssetBalanceUpdateCron>: ${getReadableError(err)}`,
      );
    }
  }

  async loadFollowers(contractId: number) {
    try {
      const contract = await this.contractService.findOne(contractId);

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const collateralInfo = this.tradingVariableServcie.getCollateral(
        contractId,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const followerEntities = await this.prismaService.follower.findMany();

      const usdcMap: Record<string, bigint> = {};

      const usdcPromises = followerEntities.map(async (entity) => {
        const balance = await publicClient.readContract({
          address: collateralInfo.collateral,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [entity.address as Address],
        });

        usdcMap[entity.address] = balance;
      });

      await Promise.allSettled(usdcPromises);

      const ethMap: Record<string, bigint> = {};

      const ethPromises = followerEntities.map(async (entity) => {
        const balance = await publicClient.getBalance({
          address: entity.address as Address,
        });

        ethMap[entity.address] = balance;
      });

      await Promise.allSettled(ethPromises);

      return followerEntities.map((entity) => ({
        ...entity,
        contractId,
        ethBalance: ethMap[entity.address]?.toString() || null,
        usdcBalance: usdcMap[entity.address]?.toString() || null,
      }));
    } catch (err) {
      this.logger.error(
        `FollowerService>loadFollowers>: ${getReadableError(err)}`,
      );
    }

    return [];
  }

  findAllDetails(contractId: number) {
    return this.loadFollowers(contractId);
  }

  findAll() {
    return this.prismaService.follower.findMany();
  }
}
