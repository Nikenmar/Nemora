import { emitLocal } from '../api/events';

export interface RuntimeEventSink {
  dataUpdated(dataType: DataUpdateEventTypes, data?: string[], message?: string): void;
  message(messageCode: MessageCodes, data?: MessageToRendererData): void;
  playSongFromUnknownSource?(data: Omit<AudioPlayerData, 'artwork'> & { artwork?: string }): void;
  openAuthUri?(uri: string): void;
}

export class LocalRuntimeEventSink implements RuntimeEventSink {
  private pending: DataUpdateEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  dataUpdated(dataType: DataUpdateEventTypes, data: string[] = [], message?: string): void {
    const existing = this.pending.find((event) => event.dataType === dataType);
    const hasDetails = data.length > 0 || message !== undefined;
    if (existing) {
      if (hasDetails) existing.eventData.push({ data, message });
    } else {
      this.pending.push({ dataType, eventData: hasDetails ? [{ data, message }] : [] });
    }

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1000);
  }

  message(messageCode: MessageCodes, data?: MessageToRendererData): void {
    emitLocal('app/sendMessageToRendererEvent', messageCode, data);
  }

  playSongFromUnknownSource(
    data: Omit<AudioPlayerData, 'artwork'> & { artwork?: string }
  ): void {
    emitLocal('app/playSongFromUnknownSource', data);
  }

  openAuthUri(uri: string): void {
    emitLocal('nemora://auth', uri);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.length === 0) return;
    const events = this.pending;
    this.pending = [];
    emitLocal('app/dataUpdateEvent', events);
  }
}
