import { createHash } from 'crypto';

export const privateRPCProviders = {
  drpc: {
    provider: 'drpc',
    getUrl: (network: string, token: string) =>
      `https://lb.drpc.live/${network}/${token}`,
    getWebsocket: (network: string, token: string) =>
      `wss://lb.drpc.live/${network}/${token}`,
    networks: {
      1: 'ethereum',
      137: 'polygon',
      8453: 'base',
      42161: 'arbitrum',
      421614: 'arbitrum-sepolia',
      33139: 'apechain',
      43114: 'avalanche',
      4326: 'megaeth',
    },
    tokens:
      process.env.DRPC_TOKENS?.split(',').filter(
        (item) => item.trim() !== '',
      ) || [],
    paidTokens:
      process.env.DRPC_PAID_TOKENS?.split(',').filter(
        (item) => item.trim() !== '',
      ) || [],
  },
  alchemy: {
    provider: 'alchemy',
    getUrl: (network: string, token: string) =>
      `https://${network}.g.alchemy.com/v2/${token}`,
    getWebsocket: (network: string, token: string) =>
      `wss://${network}.g.alchemy.com/v2/${token}`,
    networks: {
      1: 'eth-mainnet',
      137: 'polygon-mainnet',
      8453: 'base-mainnet',
      42161: 'arb-mainnet',
      421614: 'arb-sepolia',
      33139: 'apechain-mainnet',
      43114: 'avax-mainnet',
      4326: 'megaeth-mainnet',
    },
    tokens:
      process.env.ALCHEMY_TOKENS?.split(',').filter(
        (item) => item.trim() !== '',
      ) || [],
    paidTokens:
      process.env.ALCHEMY_PAID_TOENS?.split(',').filter(
        (item) => item.trim() !== '',
      ) || [],
  },
};

export const publicRpcProviders: Record<number, string[]> = {
  1: [
    'https://api.zan.top/eth-mainnet',
    'https://ethereum-rpc.publicnode.com',
    'https://eth-mainnet.public.blastapi.io',
  ],
  137: [
    // 'https://1rpc.io/matic',
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon-mainnet.public.blastapi.io',
    'https://polygon.api.onfinality.io/public',
    'https://polygon.meowrpc.com',
    'https://polygon-rpc.com',
    'https://polygon-pokt.nodies.app',
    'https://polygon.drpc.org',
    'https://polygon.rpc.subquery.network/public',
    'https://polygon.gateway.tenderly.co',
    'https://rpc-mainnet.matic.quiknode.pro',
    'https://polygon.lava.build',
    'https://polygon-public.nodies.app',
    'https://rpc.sentio.xyz/matic',
    'https://poly.api.pocket.network',
    'https://api.zan.top/polygon-mainnet',
  ],
  8453: [
    // 'https://1rpc.io/base',
    'https://base-rpc.publicnode.com',
    'https://base-mainnet.public.blastapi.io',
    'https://base.drpc.org',
    'https://base.meowrpc.com',
    'https://mainnet.base.org',
    'https://base-pokt.nodies.app',
    'https://gateway.tenderly.co/public/base',
    'https://base.api.onfinality.io/public',
    // 'https://rpc.therpc.io/base',
    'https://base.blockpi.network/v1/rpc/public',
    'https://rpc.baseazul.dev',
    'https://base.rpc.sentio.xyz',
    'https://base-mainnet.gateway.tatum.io',
    'https://rpc.nodeflare.app/base/public',
    'https://base.rpc.blxrbdn.com',
    'https://rpcbase.hairylabs.io/rpc',
  ],
  42161: [
    'https://arb1.arbitrum.io/rpc',
    // 'https://1rpc.io/arb',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arbitrum-one.public.blastapi.io',
    'https://arbitrum.meowrpc.com',
    'https://arbitrum.blockpi.network/v1/rpc/public',
    'https://arbitrum.drpc.org',
    // 'https://rpc.therpc.io/arbitrum',
    'https://arb-pokt.nodies.app',
    'https://arb-one-mainnet.gateway.tatum.io',
    'https://public-arb-mainnet.fastnode.io',
    'https://api.zan.top/arb-one',
    'https://arb-one.api.pocket.network',
    'https://arbitrum.gateway.tenderly.co',
    'https://arb1.lava.build',
    'https://arbitrum.api.onfinality.io/public',
    'https://rpc.nodeflare.app/arb/public',
    'https://arbitrum-one-public.nodies.app',
  ],
  421614: [
    'https://sepolia-rollup.arbitrum.io/rpc',
    'https://arbitrum-sepolia-rpc.publicnode.com',
    'https://arbitrum-sepolia.public.blastapi.io',
    'https://endpoints.omniatech.io/v1/arbitrum/sepolia/public',
    'https://arbitrum-sepolia.drpc.org',
  ],
  33139: [
    'https://rpc.apechain.com/http',
    'https://apechain.gateway.tenderly.co/',
    'https://33139.rpc.thirdweb.com/',
    'https://apechain.drpc.org',
    'https://rpc.apechain.com/http',
  ],
  43114: [
    'https://api.avax.network/ext/bc/C/rpc',
    'https://avalanche.drpc.org',
    'https://ava-mainnet.public.blastapi.io/ext/bc/C/rpc',
    'https://avax.meowrpc.com',
    'https://endpoints.omniatech.io/v1/avax/mainnet/public',
    'https://avalanche-c-chain-rpc.publicnode.com',
    'https://0xrpc.io/avax',
    'https://spectrum-01.simplystaking.xyz/avalanche-mn-rpc/ext/bc/C/rpc',
    'https://avalanche.api.onfinality.io/public/ext/bc/C/rpc',
    // 'https://1rpc.io/avax/c',
    'https://rpc.nodeflare.app/avax/public',
    'https://avalanche.rpc.sentio.xyz',
    'https://avalanche-mainnet.gateway.tenderly.co',
    'https://avax.api.pocket.network',
    'https://rpc.poolz.finance/avalanche',
    'https://rpc.swiftnodes.io/rpc/avalanche',
  ],
  4326: [
    'https://rpc-megaeth-mainnet.globalstake.io',
    'https://mainnet.megaeth.com/rpc',
    'https://megaeth.drpc.org',
  ],
};

// Known eth_getLogs block-range limits of free plans (verified 2026-11-22).
export const FREE_PLAN_MAX_BLOCK_RANGE: Record<string, number> = {
  drpc: 100,
  alchemy: 10,
};

export type PrivateRpcProviderKey = keyof typeof privateRPCProviders;

export function getPrivateProviderUrl(
  provider: PrivateRpcProviderKey,
  chainId: number,
  token: string,
): string | null {
  const config = privateRPCProviders[provider];
  const network = config.networks[chainId as keyof typeof config.networks];

  return network ? config.getUrl(network, token) : null;
}

// Path segments that look like API keys (dRPC/Alchemy style tokens).
const SECRET_SEGMENT = /\/([A-Za-z0-9_-]{20,})(?=\/|$|\s|"|')/g;

/** Masks API-key path segments so URLs are safe to show or log. */
export function maskRpcUrl(url: string): string {
  return url.replace(
    SECRET_SEGMENT,
    (_, secret: string) => `/${secret.slice(0, 4)}…${secret.slice(-4)}`,
  );
}

/** Redacts every RPC URL secret inside free text such as viem error messages. */
export function redactRpcSecrets(text: string): string {
  return text.replace(/https?:\/\/[^\s"']+|wss?:\/\/[^\s"']+/g, (url) =>
    maskRpcUrl(url),
  );
}

export type RpcTokenInfo = {
  /** Raw API key. Server-side only; never send to clients or logs. */
  token: string;
  /** Stable short fingerprint used to group endpoints by token. */
  tokenId: string;
  /** Masked token for display, e.g. "AkmD…x9Q2". */
  tokenHint: string;
};

/** Extracts the API key embedded in a dRPC/Alchemy style URL path. */
export function getRpcTokenInfo(url: string): RpcTokenInfo | null {
  let segments: string[];

  try {
    segments = new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return null;
  }

  const token = segments
    .reverse()
    .find((segment) => /^[A-Za-z0-9_-]{20,}$/.test(segment));

  if (!token) {
    return null;
  }

  return {
    token,
    tokenId: createHash('sha256').update(token).digest('hex').slice(0, 12),
    tokenHint: `${token.slice(0, 4)}…${token.slice(-4)}`,
  };
}
