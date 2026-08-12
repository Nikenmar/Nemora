import { subscribe, tuplePayload, unsubscribe } from './events';

type MessagePayload = [messageCode: MessageCodes, data?: Record<string, unknown>];
type MessageCallback = (
  event: unknown,
  messageCode: MessageCodes,
  data?: Record<string, unknown>
) => void;

export const messages = {
  getMessageFromMain: (callback: MessageCallback): void =>
    subscribe('app/sendMessageToRendererEvent', callback, tuplePayload<MessagePayload>),
  removeMessageToRendererEventListener: (callback: MessageCallback): void =>
    unsubscribe('app/sendMessageToRendererEvent', callback)
};
