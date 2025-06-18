import { Injectable } from '@nestjs/common';
import { Follower } from 'src/follower/entities/follower.entity';

import {
  createWalletClient,
  createPublicClient,
  WalletClient,
  PublicClient,
  http,
  fallback,
} from 'viem';
import { english, mnemonicToAccount } from 'viem/accounts';
import {
  arbitrum,
  arbitrumSepolia,
  base,
  polygon,
  apeChain,
  Chain,
} from 'viem/chains';
import 'dotenv';

import { validateMnemonic } from '@scure/bip39';
import { EncryptedData, SecurityService } from './security.service';

const rpcUrls = {
  137: [
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AnxSCzrS6kLymZIBqC68tbmkEZm5J1oR8IUSEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AtA3DzvN80VAuMXpEuYs0Mwy1dvpKa4R8I32EjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AujdrLCySkHriKcgivXkfC0gs51UKa8R8I35EjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=Asn7XUs2fkptrHY34vZx5MFV10lJKbMR8I4FEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=Aiio8plb7kwEgVttGQTB3IEuci3CKbUR8I4OEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AtlOYq-ZCkL8jXgPHIzwPncmB_E4LAsR8JkoEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AloSriF4B0nggEsKDMYiOnCUPYBmLAwR8JktEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=ApKBwP0pl0l6ln5RcDDqlLlFHxYWLA4R8JkyEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AkNxllrJh0nksMTENrcqKm1DFf5kMWER8JFMzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=ApVf0uNDHkPam4cKtEZkmdOABGQQMWIR8JFmzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=Ai7nDC0ZDkOIuUPRt36OQX8VJV66MWMR8JFvzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AuMyZSJJTUrJm17HmV-gSBKLouOVMWMR8JF0zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AqDEH4eq0kRIjc40MipYGQEAGVw1MWQR8JF2zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AkswE_iiZUmtiPuxd0CraLwC6_hnMWUR8JF6zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=An5iFO58sk0nlEXPDJCF_6XLwuqPMWUR8JGAzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AtktOWrzeUTEi2EVRcWmUKIa4ZYKNVER8KcdbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=Aqq3FuSAAED6kMaZiiiLXCeU8nNfNVER8KcibrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AkQNsv9c6E_1qKEVLn2s0ygVbTupNVIR8KcjbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AmdqXkkNLUGYmQXRDL-5igWAobmiNVIR8KckbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=An4YvT8YRUFwt8RqK1hWUg_zfgBINVIR8KcnbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AlR_TmfXQUU-pB7upZ6E0-Z18O97NVMR8KcqbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AifMkmm5G0pnvqmEBLdeSrX9FFmsNVMR8KcrbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=Ard4jC4mIk0XsnxBlrzM9rufePoANVQR8KcwbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AmZAx6KHJEz3n9Bj00HP0foWrZtGNVUR8KcybrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=Ago1ytX_50a7nn9yE2Qdq6MN-zZvNVYR8Kc2brRhIxXF',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AjfXw1CrM0jCosH83uXA2CIZOBxyNVcR8Kc5brRhIxXF',
    'https://lb.drpc.org/ogrpc?network=polygon&dkey=AtPNaMCuBURqjAcNlkanGoh8sK2ZNVcR8Kc7brRhIxXF',
    'https://polygon-mainnet.g.alchemy.com/v2/Zxh4D-fVDWSXyUJbN5ZITVgjbET7-9N_',
    'https://polygon-mainnet.g.alchemy.com/v2/fDh9_XoNmoCdrrqPuU6wxoKRuSP1OM90',
    'https://polygon-mainnet.g.alchemy.com/v2/OUfJrKB_TzPSqYwzk0KgjeNDg_bb4k2u',
    'https://polygon-mainnet.g.alchemy.com/v2/JsxyfNiRtf4XV58c4onA7-QdK2_UA6-o',
  ],
  8453: [
    'https://lb.drpc.org/ogrpc?network=base&dkey=AnxSCzrS6kLymZIBqC68tbmkEZm5J1oR8IUSEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AtA3DzvN80VAuMXpEuYs0Mwy1dvpKa4R8I32EjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AujdrLCySkHriKcgivXkfC0gs51UKa8R8I35EjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=base&dkey=Asn7XUs2fkptrHY34vZx5MFV10lJKbMR8I4FEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=base&dkey=Aiio8plb7kwEgVttGQTB3IEuci3CKbUR8I4OEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AtlOYq-ZCkL8jXgPHIzwPncmB_E4LAsR8JkoEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AloSriF4B0nggEsKDMYiOnCUPYBmLAwR8JktEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=base&dkey=ApKBwP0pl0l6ln5RcDDqlLlFHxYWLA4R8JkyEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AkNxllrJh0nksMTENrcqKm1DFf5kMWER8JFMzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=base&dkey=ApVf0uNDHkPam4cKtEZkmdOABGQQMWIR8JFmzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=base&dkey=Ai7nDC0ZDkOIuUPRt36OQX8VJV66MWMR8JFvzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AuMyZSJJTUrJm17HmV-gSBKLouOVMWMR8JF0zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AqDEH4eq0kRIjc40MipYGQEAGVw1MWQR8JF2zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AkswE_iiZUmtiPuxd0CraLwC6_hnMWUR8JF6zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=base&dkey=An5iFO58sk0nlEXPDJCF_6XLwuqPMWUR8JGAzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AtktOWrzeUTEi2EVRcWmUKIa4ZYKNVER8KcdbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=base&dkey=Aqq3FuSAAED6kMaZiiiLXCeU8nNfNVER8KcibrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AkQNsv9c6E_1qKEVLn2s0ygVbTupNVIR8KcjbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AmdqXkkNLUGYmQXRDL-5igWAobmiNVIR8KckbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=base&dkey=An4YvT8YRUFwt8RqK1hWUg_zfgBINVIR8KcnbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AlR_TmfXQUU-pB7upZ6E0-Z18O97NVMR8KcqbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AifMkmm5G0pnvqmEBLdeSrX9FFmsNVMR8KcrbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=base&dkey=Ard4jC4mIk0XsnxBlrzM9rufePoANVQR8KcwbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AmZAx6KHJEz3n9Bj00HP0foWrZtGNVUR8KcybrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=base&dkey=Ago1ytX_50a7nn9yE2Qdq6MN-zZvNVYR8Kc2brRhIxXF',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AjfXw1CrM0jCosH83uXA2CIZOBxyNVcR8Kc5brRhIxXF',
    'https://lb.drpc.org/ogrpc?network=base&dkey=AtPNaMCuBURqjAcNlkanGoh8sK2ZNVcR8Kc7brRhIxXF',
    'https://base-mainnet.g.alchemy.com/v2/Zxh4D-fVDWSXyUJbN5ZITVgjbET7-9N_',
    'https://base-mainnet.g.alchemy.com/v2/fDh9_XoNmoCdrrqPuU6wxoKRuSP1OM90',
    'https://base-mainnet.g.alchemy.com/v2/OUfJrKB_TzPSqYwzk0KgjeNDg_bb4k2u',
    'https://base-mainnet.g.alchemy.com/v2/JsxyfNiRtf4XV58c4onA7-QdK2_UA6-o',
  ],
  42161: [
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AnxSCzrS6kLymZIBqC68tbmkEZm5J1oR8IUSEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AtA3DzvN80VAuMXpEuYs0Mwy1dvpKa4R8I32EjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AujdrLCySkHriKcgivXkfC0gs51UKa8R8I35EjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=Asn7XUs2fkptrHY34vZx5MFV10lJKbMR8I4FEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=Aiio8plb7kwEgVttGQTB3IEuci3CKbUR8I4OEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AtlOYq-ZCkL8jXgPHIzwPncmB_E4LAsR8JkoEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AloSriF4B0nggEsKDMYiOnCUPYBmLAwR8JktEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=ApKBwP0pl0l6ln5RcDDqlLlFHxYWLA4R8JkyEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AkNxllrJh0nksMTENrcqKm1DFf5kMWER8JFMzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=ApVf0uNDHkPam4cKtEZkmdOABGQQMWIR8JFmzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=Ai7nDC0ZDkOIuUPRt36OQX8VJV66MWMR8JFvzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AuMyZSJJTUrJm17HmV-gSBKLouOVMWMR8JF0zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AqDEH4eq0kRIjc40MipYGQEAGVw1MWQR8JF2zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AkswE_iiZUmtiPuxd0CraLwC6_hnMWUR8JF6zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=An5iFO58sk0nlEXPDJCF_6XLwuqPMWUR8JGAzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AtktOWrzeUTEi2EVRcWmUKIa4ZYKNVER8KcdbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=Aqq3FuSAAED6kMaZiiiLXCeU8nNfNVER8KcibrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AkQNsv9c6E_1qKEVLn2s0ygVbTupNVIR8KcjbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AmdqXkkNLUGYmQXRDL-5igWAobmiNVIR8KckbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=An4YvT8YRUFwt8RqK1hWUg_zfgBINVIR8KcnbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AlR_TmfXQUU-pB7upZ6E0-Z18O97NVMR8KcqbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AifMkmm5G0pnvqmEBLdeSrX9FFmsNVMR8KcrbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=Ard4jC4mIk0XsnxBlrzM9rufePoANVQR8KcwbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AmZAx6KHJEz3n9Bj00HP0foWrZtGNVUR8KcybrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=Ago1ytX_50a7nn9yE2Qdq6MN-zZvNVYR8Kc2brRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AjfXw1CrM0jCosH83uXA2CIZOBxyNVcR8Kc5brRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AtPNaMCuBURqjAcNlkanGoh8sK2ZNVcR8Kc7brRhIxXF',
    'https://arb-mainnet.g.alchemy.com/v2/Zxh4D-fVDWSXyUJbN5ZITVgjbET7-9N_',
    'https://arb-mainnet.g.alchemy.com/v2/fDh9_XoNmoCdrrqPuU6wxoKRuSP1OM90',
    'https://arb-mainnet.g.alchemy.com/v2/OUfJrKB_TzPSqYwzk0KgjeNDg_bb4k2u',
    'https://arb-mainnet.g.alchemy.com/v2/JsxyfNiRtf4XV58c4onA7-QdK2_UA6-o',
  ],
  421614: [
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AnxSCzrS6kLymZIBqC68tbmkEZm5J1oR8IUSEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AtA3DzvN80VAuMXpEuYs0Mwy1dvpKa4R8I32EjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AujdrLCySkHriKcgivXkfC0gs51UKa8R8I35EjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=Asn7XUs2fkptrHY34vZx5MFV10lJKbMR8I4FEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=Aiio8plb7kwEgVttGQTB3IEuci3CKbUR8I4OEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AtlOYq-ZCkL8jXgPHIzwPncmB_E4LAsR8JkoEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AloSriF4B0nggEsKDMYiOnCUPYBmLAwR8JktEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=ApKBwP0pl0l6ln5RcDDqlLlFHxYWLA4R8JkyEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AkNxllrJh0nksMTENrcqKm1DFf5kMWER8JFMzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=Ai7nDC0ZDkOIuUPRt36OQX8VJV66MWMR8JFvzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AuMyZSJJTUrJm17HmV-gSBKLouOVMWMR8JF0zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AqDEH4eq0kRIjc40MipYGQEAGVw1MWQR8JF2zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AkswE_iiZUmtiPuxd0CraLwC6_hnMWUR8JF6zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=An5iFO58sk0nlEXPDJCF_6XLwuqPMWUR8JGAzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AtktOWrzeUTEi2EVRcWmUKIa4ZYKNVER8KcdbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=Aqq3FuSAAED6kMaZiiiLXCeU8nNfNVER8KcibrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AkQNsv9c6E_1qKEVLn2s0ygVbTupNVIR8KcjbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AmdqXkkNLUGYmQXRDL-5igWAobmiNVIR8KckbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=An4YvT8YRUFwt8RqK1hWUg_zfgBINVIR8KcnbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AlR_TmfXQUU-pB7upZ6E0-Z18O97NVMR8KcqbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AifMkmm5G0pnvqmEBLdeSrX9FFmsNVMR8KcrbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=Ard4jC4mIk0XsnxBlrzM9rufePoANVQR8KcwbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AmZAx6KHJEz3n9Bj00HP0foWrZtGNVUR8KcybrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=Ago1ytX_50a7nn9yE2Qdq6MN-zZvNVYR8Kc2brRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AjfXw1CrM0jCosH83uXA2CIZOBxyNVcR8Kc5brRhIxXF',
    'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AtPNaMCuBURqjAcNlkanGoh8sK2ZNVcR8Kc7brRhIxXF',
    'https://arb-sepolia.g.alchemy.com/v2/Zxh4D-fVDWSXyUJbN5ZITVgjbET7-9N_',
    'https://arb-sepolia.g.alchemy.com/v2/fDh9_XoNmoCdrrqPuU6wxoKRuSP1OM90',
    'https://arb-sepolia.g.alchemy.com/v2/OUfJrKB_TzPSqYwzk0KgjeNDg_bb4k2u',
    'https://arb-sepolia.g.alchemy.com/v2/JsxyfNiRtf4XV58c4onA7-QdK2_UA6-o',
  ],
  33139: [
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AnxSCzrS6kLymZIBqC68tbmkEZm5J1oR8IUSEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AtA3DzvN80VAuMXpEuYs0Mwy1dvpKa4R8I32EjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AujdrLCySkHriKcgivXkfC0gs51UKa8R8I35EjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=Asn7XUs2fkptrHY34vZx5MFV10lJKbMR8I4FEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=Aiio8plb7kwEgVttGQTB3IEuci3CKbUR8I4OEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AtlOYq-ZCkL8jXgPHIzwPncmB_E4LAsR8JkoEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AloSriF4B0nggEsKDMYiOnCUPYBmLAwR8JktEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=ApKBwP0pl0l6ln5RcDDqlLlFHxYWLA4R8JkyEjfP07KJ',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AkNxllrJh0nksMTENrcqKm1DFf5kMWER8JFMzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=ApVf0uNDHkPam4cKtEZkmdOABGQQMWIR8JFmzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=Ai7nDC0ZDkOIuUPRt36OQX8VJV66MWMR8JFvzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AuMyZSJJTUrJm17HmV-gSBKLouOVMWMR8JF0zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AqDEH4eq0kRIjc40MipYGQEAGVw1MWQR8JF2zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AkswE_iiZUmtiPuxd0CraLwC6_hnMWUR8JF6zoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=An5iFO58sk0nlEXPDJCF_6XLwuqPMWUR8JGAzoXPVSjK',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AtktOWrzeUTEi2EVRcWmUKIa4ZYKNVER8KcdbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=Aqq3FuSAAED6kMaZiiiLXCeU8nNfNVER8KcibrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AkQNsv9c6E_1qKEVLn2s0ygVbTupNVIR8KcjbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AmdqXkkNLUGYmQXRDL-5igWAobmiNVIR8KckbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=An4YvT8YRUFwt8RqK1hWUg_zfgBINVIR8KcnbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AlR_TmfXQUU-pB7upZ6E0-Z18O97NVMR8KcqbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AifMkmm5G0pnvqmEBLdeSrX9FFmsNVMR8KcrbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=Ard4jC4mIk0XsnxBlrzM9rufePoANVQR8KcwbrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AmZAx6KHJEz3n9Bj00HP0foWrZtGNVUR8KcybrRhIxXF',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=Ago1ytX_50a7nn9yE2Qdq6MN-zZvNVYR8Kc2brRhIxXF',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AjfXw1CrM0jCosH83uXA2CIZOBxyNVcR8Kc5brRhIxXF',
    'https://lb.drpc.org/ogrpc?network=apechain&dkey=AtPNaMCuBURqjAcNlkanGoh8sK2ZNVcR8Kc7brRhIxXF',
    'https://apechain-mainnet.g.alchemy.com/v2/Zxh4D-fVDWSXyUJbN5ZITVgjbET7-9N_',
    'https://apechain-mainnet.g.alchemy.com/v2/fDh9_XoNmoCdrrqPuU6wxoKRuSP1OM90',
    'https://apechain-mainnet.g.alchemy.com/v2/OUfJrKB_TzPSqYwzk0KgjeNDg_bb4k2u',
    'https://apechain-mainnet.g.alchemy.com/v2/JsxyfNiRtf4XV58c4onA7-QdK2_UA6-o',
  ],
};

@Injectable()
export class ChainsService {
  readonly availableChains: Chain[];
  readonly publicClients: Record<number, PublicClient>;
  private walletClients: Record<number, Record<string, WalletClient>>;

  constructor(private securityService: SecurityService) {
    this.availableChains = [arbitrum, polygon, base, arbitrumSepolia, apeChain];
    this.publicClients = {};
    this.walletClients = {};

    this.availableChains.forEach((chain) => {
      this.publicClients[chain.id] = createPublicClient({
        chain: chain,
        transport: fallback(
          [
            ...rpcUrls[chain.id as keyof typeof rpcUrls].map((url) =>
              http(url, { batch: true }),
            ),
          ],
          {
            rank: {
              interval: 60_000,
            },
          },
        ),
        batch: {
          multicall: true,
        },
      }) as unknown as PublicClient;
    });
  }

  publicClient(chainId: number): PublicClient {
    if (!this.isValidChainId(chainId)) {
      throw new Error('Invalid chainId');
    }

    return this.publicClients[chainId];
  }

  getChainByChainId(chainId: number): Chain | null {
    return this.availableChains.find((item) => item.id === chainId) || null;
  }

  isValidChainId(chainId: number) {
    return !!this.getChainByChainId(chainId);
  }

  walletClient(
    mnemonicStr: string,
    chainId: number,
    follower: Follower,
  ): WalletClient {
    if (this.walletClients[chainId]?.[follower.address]) {
      return this.walletClients[chainId][follower.address];
    }

    const chain = this.getChainByChainId(chainId);

    if (!chain) {
      throw new Error('Invalid chain id');
    }

    const mnemonic = this.securityService.isSafeApp
      ? this.securityService.decrypt(JSON.parse(mnemonicStr) as EncryptedData)
      : mnemonicStr;

    if (!validateMnemonic(mnemonic, english)) {
      throw new Error('Wrong mnemonic, plz check seed the db metadata');
    }

    const account = mnemonicToAccount(mnemonic, {
      accountIndex: follower.accountIndex,
    });

    const client = createWalletClient({
      account,
      chain: chain,
      transport: fallback(
        [
          ...rpcUrls[chain.id as keyof typeof rpcUrls].map((url) =>
            http(url, { batch: true }),
          ),
        ],
        {
          rank: {
            interval: 60_000,
          },
        },
      ),
    });

    if (this.walletClients[chainId]) {
      this.walletClients[chainId][account.address] = client;
    } else {
      this.walletClients[chainId] = {
        [account.address]: client,
      };
    }

    return client;
  }
}
