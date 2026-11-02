/**
 * PLAN/21 P21.2: the view's one way to call a Rust command, typed from Rust.
 *
 * `generated.ts` is written from the commands themselves (`src-tauri/src/ipc_types.rs`); this file
 * only gives `invoke` those types. At run time `ipc(command, args)` is `invoke(command, args)`.
 *
 * - A command Rust types: the arguments and the answer are the generated ones.
 * - A command answering any JSON (`serde_json::Value`, `JsonAnswerCommand`): its arguments are
 *   still checked, and the answer is what the caller expects (inferred from where it goes), the
 *   view's own declaration until the core types it.
 * - An argument Rust takes as any JSON (`JsonArgsCommand`) takes whatever the view sends there.
 */
import { invoke } from '@tauri-apps/api/core';

import type { IpcCommands, JsonAnswerCommand, Value } from './generated';

export type * from './generated';

export type Command = keyof IpcCommands;
export type TypedCommand = Exclude<Command, JsonAnswerCommand>;
/** The answer; a Rust `()` arrives as `null` and carries nothing, so it is `void` here. */
export type IpcAnswer<K extends Command> = [IpcCommands[K]['ret']] extends [null] ? void : IpcCommands[K]['ret'];

/** Exactly `Value` (or `Value | null`): any JSON, where the view's declared type goes as is. */
type IsJson<T> = [Value] extends [T] ? ([Exclude<T, undefined>] extends [Value] ? true : false) : false;
type IsJsonList<T> = [T] extends [Value[]] ? ([Value[]] extends [T] ? true : false) : false;
type ViewSends<T> = IsJson<T> extends true ? unknown : IsJsonList<T> extends true ? unknown[] : T;

/** What the view sends: the generated arguments, with any-JSON ones open. */
export type IpcArgs<K extends Command> = { [P in keyof IpcCommands[K]['args']]: ViewSends<IpcCommands[K]['args'][P]> };
export type ArgList<K extends Command> = Record<string, never> extends IpcArgs<K> ? [args?: IpcArgs<K>] : [args: IpcArgs<K>];

export function ipc<K extends TypedCommand>(command: K, ...args: ArgList<K>): Promise<IpcAnswer<K>>;
export function ipc<K extends JsonAnswerCommand, T>(command: K, ...args: ArgList<K>): Promise<T>;
export function ipc(command: Command, args?: Record<string, unknown>): Promise<unknown> {
  return invoke(command, args);
}
