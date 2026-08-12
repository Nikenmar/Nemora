import type { StorePort } from '../contracts/store';
import { TauriStorePort } from '../stores';
import { RuntimeNotHydratedError } from './errors';
import { NoraRuntime, type NoraRuntimeOptions } from './runtime';

let runtime: NoraRuntime | undefined;
let hydration: Promise<NoraRuntime> | undefined;

export function configureRuntime(port: StorePort, options: NoraRuntimeOptions): NoraRuntime {
  if (hydration || runtime?.isHydrated()) throw new Error('Nemora runtime is already configured');
  runtime = new NoraRuntime(port, options);
  return runtime;
}

export async function hydrateRuntime(): Promise<NoraRuntime> {
  if (runtime?.isHydrated()) return runtime;
  if (hydration) return hydration;

  hydration = (async () => {
    if (!runtime) {
      const { createProductionRuntimeOptions } = await import('./production');
      runtime = new NoraRuntime(new TauriStorePort(), await createProductionRuntimeOptions());
    }
    await runtime.hydrate();
    return runtime;
  })();

  try {
    return await hydration;
  } catch (error) {
    hydration = undefined;
    throw error;
  }
}

export function getRuntime(): NoraRuntime {
  if (!runtime?.isHydrated()) throw new RuntimeNotHydratedError();
  return runtime;
}

export function resetRuntimeForTests(): void {
  runtime = undefined;
  hydration = undefined;
}
