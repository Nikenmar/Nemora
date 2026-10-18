import type { InvokePort, ShellEventPort, Unlisten } from './types';

export const POWER_SOURCE_CHANGED_EVENT = 'nemora://power-source-changed';
export const GET_POWER_STATE_COMMAND = 'get_power_state';

export interface PowerState {
  isOnBatteryPower: boolean;
}

export interface PowerStatePort {
  current(): Promise<PowerState>;
  subscribe(handler: (state: PowerState) => void): Promise<Unlisten>;
}

export class TauriPowerStatePort implements PowerStatePort {
  private readonly commands: InvokePort;
  private readonly events: ShellEventPort;

  constructor(commands: InvokePort, events: ShellEventPort) {
    this.commands = commands;
    this.events = events;
  }

  current(): Promise<PowerState> {
    return this.commands.invoke<PowerState>(GET_POWER_STATE_COMMAND);
  }

  subscribe(handler: (state: PowerState) => void): Promise<Unlisten> {
    return this.events.listen<PowerState>(POWER_SOURCE_CHANGED_EVENT, handler);
  }
}

export class PowerController {
  private readonly port: PowerStatePort;
  private readonly changed: (isOnBatteryPower: boolean) => void;
  private unlisten: Unlisten | undefined;
  private lastValue: boolean | undefined;

  constructor(port: PowerStatePort, changed: (isOnBatteryPower: boolean) => void) {
    this.port = port;
    this.changed = changed;
  }

  async start(): Promise<boolean> {
    this.unlisten = await this.port.subscribe((state) => this.publish(state));
    const state = await this.port.current();
    this.publish(state);
    return state.isOnBatteryPower;
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = undefined;
  }

  private publish(state: PowerState): void {
    if (state.isOnBatteryPower === this.lastValue) return;
    this.lastValue = state.isOnBatteryPower;
    this.changed(state.isOnBatteryPower);
  }
}
