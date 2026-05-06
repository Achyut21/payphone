import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createPublicClient, formatUnits, http, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import { ACTIVE_USDC_ADDRESS, USDC_DECIMALS } from '../lib/constants';

async function main() {
  const txHash = process.argv[2];
  if (!txHash || !txHash.startsWith('0x')) {
    console.error('usage: pnpm tsx scripts/verify-tx.ts <0xTxHash>');
    process.exit(1);
  }
  const c = createPublicClient({ chain: baseSepolia, transport: http() });

  const [tx, receipt] = await Promise.all([
    c.getTransaction({ hash: txHash as `0x${string}` }),
    c.getTransactionReceipt({ hash: txHash as `0x${string}` }),
  ]);

  console.log(`tx hash:       ${tx.hash}`);
  console.log(`status:        ${receipt.status}`);
  console.log(`block:         ${receipt.blockNumber}`);
  console.log(`from:          ${tx.from}`);
  console.log(`to:            ${tx.to}`);
  console.log(`gas used:      ${receipt.gasUsed}`);

  // Decode USDC Transfer events from this tx (topic[1]=from, topic[2]=to, data=value)
  const transferEvent = parseAbiItem(
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  );
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const transfers = receipt.logs
    .filter(
      (log) =>
        log.address.toLowerCase() === ACTIVE_USDC_ADDRESS.toLowerCase() &&
        log.topics[0] === transferTopic,
    )
    .map((log) => {
      const fromAddr = '0x' + (log.topics[1] ?? '').slice(26);
      const toAddr = '0x' + (log.topics[2] ?? '').slice(26);
      const value = BigInt(log.data);
      return {
        from: fromAddr,
        to: toAddr,
        value,
        valueUsdc: formatUnits(value, USDC_DECIMALS),
      };
    });
  void transferEvent;

  console.log(`\nUSDC Transfer events (${transfers.length}):`);
  for (const t of transfers) {
    console.log(`  ${t.from} -> ${t.to}: $${t.valueUsdc} USDC`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
