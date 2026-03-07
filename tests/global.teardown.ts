import { stopMonerod } from "./helpers/monerod";

function globalTeardown(): void {
  stopMonerod();
}

export default globalTeardown;
