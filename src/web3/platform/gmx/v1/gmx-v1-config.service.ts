import { Injectable } from '@nestjs/common';
import { Address, parseAbi } from 'viem';
import * as fs from 'fs';
import * as path from 'path';

import { ChainPriority } from 'src/types';
import { EvmChainsService } from 'src/web3/web3/evm-chains.service';

import { gmxV1VaultReadAbi } from './abi/Vault';
import { gmxV1VaultDeployments } from './configs/contracts';
import { GmxV1IndexTokenConfig } from './configs/tokens';
import { toGmxV1AssetSymbol } from './configs/token-normalization';

const erc20MetadataAbi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

type VaultTokenConfig = GmxV1IndexTokenConfig;

/**
 * Generates the committed GMX V1 token snapshot used by historical parsers.
 *
 * The Vault retains every address ever configured in `allWhitelistedTokens`,
 * even after `clearTokenConfig`. Reading that array at the fixed `toBlock`
 * therefore preserves the historical address universe without maintaining a
 * hand-written market registry.
 */
@Injectable()
export class GmxV1ConfigService {
  constructor(private readonly chainsService: EvmChainsService) {
    // this.generateTokenSnapshot();
  }

  async generateTokenSnapshot(
    outputPath = path.resolve(
      process.cwd(),
      'src/web3/platform/gmx/v1/configs/tokens.generated.json',
    ),
  ): Promise<Record<number, Record<string, VaultTokenConfig>>> {
    const generatedEntries = await Promise.all(
      gmxV1VaultDeployments.map(
        async (deployment) =>
          [
            deployment.chainId,
            await this.readVaultTokenConfigs(deployment),
          ] as const,
      ),
    );
    const configs = Object.fromEntries(generatedEntries);

    fs.writeFileSync(outputPath, `${JSON.stringify(configs, null, 2)}\n`);

    return configs;
  }

  private async readVaultTokenConfigs(
    deployment: (typeof gmxV1VaultDeployments)[number],
  ): Promise<Record<string, VaultTokenConfig>> {
    const blockNumber = BigInt(deployment.toBlock);
    const address = deployment.address as Address;
    const tokenCount = await this.chainsService.readWithSemaphore(
      deployment.chainId,
      ChainPriority.LOW,
      async (publicClient) =>
        (await publicClient.readContract({
          address,
          abi: gmxV1VaultReadAbi,
          functionName: 'allWhitelistedTokensLength',
          blockNumber,
        })) as bigint,
    );
    const tokenAddresses = await this.chainsService.readWithSemaphore(
      deployment.chainId,
      ChainPriority.LOW,
      async (publicClient) =>
        (await publicClient.multicall({
          allowFailure: false,
          blockNumber,
          contracts: Array.from({ length: Number(tokenCount) }, (_, index) => ({
            address,
            abi: gmxV1VaultReadAbi,
            functionName: 'allWhitelistedTokens',
            args: [BigInt(index)],
          })),
        })) as unknown as Address[],
    );

    const tokenConfigs = await Promise.all(
      [...new Set(tokenAddresses.map((token) => token.toLowerCase()))].map(
        async (token) =>
          this.readTokenConfig(
            deployment.chainId,
            address,
            token as Address,
            blockNumber,
          ),
      ),
    );

    return Object.fromEntries(
      tokenConfigs.map((tokenConfig) => [
        tokenConfig.address.toLowerCase(),
        tokenConfig,
      ]),
    );
  }

  private async readTokenConfig(
    chainId: number,
    vaultAddress: Address,
    tokenAddress: Address,
    blockNumber: bigint,
  ): Promise<VaultTokenConfig> {
    const [
      isWhitelisted,
      isStable,
      isShortable,
      vaultDecimals,
      tokenSymbol,
      tokenDecimals,
    ] = await this.chainsService.readWithSemaphore(
      chainId,
      ChainPriority.LOW,
      async (publicClient) =>
        (await publicClient.multicall({
          allowFailure: false,
          blockNumber,
          contracts: [
            {
              address: vaultAddress,
              abi: gmxV1VaultReadAbi,
              functionName: 'whitelistedTokens',
              args: [tokenAddress],
            },
            {
              address: vaultAddress,
              abi: gmxV1VaultReadAbi,
              functionName: 'stableTokens',
              args: [tokenAddress],
            },
            {
              address: vaultAddress,
              abi: gmxV1VaultReadAbi,
              functionName: 'shortableTokens',
              args: [tokenAddress],
            },
            {
              address: vaultAddress,
              abi: gmxV1VaultReadAbi,
              functionName: 'tokenDecimals',
              args: [tokenAddress],
            },
            {
              address: tokenAddress,
              abi: erc20MetadataAbi,
              functionName: 'symbol',
            },
            {
              address: tokenAddress,
              abi: erc20MetadataAbi,
              functionName: 'decimals',
            },
          ],
        })) as unknown as [boolean, boolean, boolean, bigint, string, number],
    );
    const decimals = Number(vaultDecimals || BigInt(tokenDecimals));
    const assetSymbol = toGmxV1AssetSymbol(tokenSymbol);

    return {
      address: tokenAddress.toLowerCase() as Address,
      tokenSymbol,
      assetSymbol,
      pair: `${assetSymbol.toLowerCase()}/usd`,
      decimals,
      isWhitelisted,
      isStable,
      isShortable,
    };
  }
}
