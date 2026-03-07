import { stopMonerod } from "./helpers/monerod";

async function globalTeardown(): Promise<void> {
  await stopMonerod();
}

export default globalTeardown;
