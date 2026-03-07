import { startMonerod } from "./helpers/monerod";

async function globalSetup(): Promise<void> {
  await startMonerod();
}

export default globalSetup;
