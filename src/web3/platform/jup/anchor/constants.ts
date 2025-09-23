import { web3, AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import { IDL, type Perpetuals } from './idl/jupiter-perpetuals-idl';

const RPC_CONNECTION = new web3.Connection(
  process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
);

export const JUPITER_PERPETUALS_PROGRAM_ID = new web3.PublicKey(
  'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu',
);

export const JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY = new web3.PublicKey(
  '37hJBDnntwqhGbK7L6M1bLyvccj4u55CCUiLPdYkiqBN',
);

export const JLP_POOL_ACCOUNT_PUBKEY = new web3.PublicKey(
  '5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq',
);

export const JLP_MINT_PUBKEY = new web3.PublicKey(
  '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
);

export const JUPITER_PERPETUALS_PROGRAM = new Program<Perpetuals>(
  IDL,
  JUPITER_PERPETUALS_PROGRAM_ID,
  new AnchorProvider(
    RPC_CONNECTION,
    new Wallet(web3.Keypair.generate()),
    AnchorProvider.defaultOptions(),
  ),
);

export enum CUSTODY_PUBKEY {
  SOL = '7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz',
  ETH = 'AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn',
  BTC = '5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm',
  USDC = 'G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa',
  USDT = '4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk',
}

export const CUSTODY_PUBKEYS = [
  new web3.PublicKey(CUSTODY_PUBKEY.SOL),
  new web3.PublicKey(CUSTODY_PUBKEY.BTC),
  new web3.PublicKey(CUSTODY_PUBKEY.ETH),
  new web3.PublicKey(CUSTODY_PUBKEY.USDC),
  new web3.PublicKey(CUSTODY_PUBKEY.USDT),
];

export const USDC_DECIMALS = 6;
export const BPS_POWER = new BN(10_000);
export const DBPS_POWER = new BN(100_000);
export const RATE_POWER = new BN(1_000_000_000);
export const DEBT_POWER = RATE_POWER;
export const BORROW_SIZE_PRECISION = new BN(1000);
export const JLP_DECIMALS = 6;
