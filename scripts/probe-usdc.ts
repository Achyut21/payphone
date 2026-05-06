import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { ACTIVE_USDC_ADDRESS } from '../lib/constants';

const abi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'version',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'authorizationState',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

async function main() {
  const c = createPublicClient({ chain: baseSepolia, transport: http() });
  console.log(`probing ${ACTIVE_USDC_ADDRESS}`);

  for (const fn of ['name', 'symbol', 'version', 'decimals', 'DOMAIN_SEPARATOR'] as const) {
    try {
      const v = await c.readContract({ address: ACTIVE_USDC_ADDRESS, abi, functionName: fn });
      console.log(`  ${fn} = ${v}`);
    } catch (e) {
      console.log(`  ${fn} -> ERROR: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    }
  }

  // Probe EIP-3009 support: random nonce/address, expect bool=false (NOT a revert)
  try {
    const v = await c.readContract({
      address: ACTIVE_USDC_ADDRESS,
      abi,
      functionName: 'authorizationState',
      args: [
        '0xE01669A01E28E905055Ac6cD33c19ced7e10d870',
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      ],
    });
    console.log(`  authorizationState(0xE016..., 0x..0001) = ${v}  (EIP-3009 supported)`);
  } catch (e) {
    console.log(
      `  authorizationState -> ERROR (EIP-3009 NOT supported as expected): ${e instanceof Error ? e.message.split('\n')[0] : e}`,
    );
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
