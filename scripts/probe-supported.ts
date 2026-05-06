import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { facilitator } from '@coinbase/x402';
import { HTTPFacilitatorClient } from '@x402/core/http';

async function main() {
  const c = new HTTPFacilitatorClient(facilitator);
  const supported = await c.getSupported();
  console.log(JSON.stringify(supported, null, 2));
}
main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
