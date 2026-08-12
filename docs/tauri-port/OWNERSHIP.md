# Владение файлами — восемь агентов, одно дерево

Все работают в `E:\Nora-CMRFork` на ветке `port/tauri-v2`. Изоляции нет,
поэтому границы держатся дисциплиной и проверяются `git diff`.

## Железные правила

1. **Правь только свои файлы.** Нужен чужой файл — напиши координатору, не
   правь сам.
2. **`src/main/**` не трогает никто.** Electron обязан собираться всю дорогу
   (`npm run build`). Логика переезжает копированием в `src/platform/`,
   оригинал остаётся жить.
3. **`src/renderer/**` не трогает никто** на этом этапе. Цель — чтобы 311
   вызовов `window.api.*` остались без изменений.
4. **Общие файлы принадлежат координатору**: `package.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/capabilities/**`,
   `src-tauri/src/main.rs`, `src/platform/contracts/**`, `docs/**`.
   Нужно изменение — запрос координатору.
5. **`%APPDATA%\Nora` — только чтение.** Записывать в реальный профиль
   запрещено всем. Тесты работают на копии, путь выдаётся в задаче.
6. Каждый агент отвечает за то, что `npx tsc --noEmit -p tsconfig.web.json`
   не ломается его изменениями.

## Карта

| Агент | Владеет | Не трогает |
|---|---|---|
| **rust-fsops** (codex) | `src-tauri/src/fsops.rs` | всё остальное |
| **rust-os** (codex) | `src-tauri/src/taskbar.rs`, `discord.rs`, `window_state.rs` | всё остальное |
| **data-layer** (codex) | `src/platform/stores/**` | контракты |
| **migration** (codex) | `src/platform/migration/**` | контракты |
| **api-bridge** (opencode) | `src/platform/api/**` | `src/renderer/**` |
| **port-pure** (opencode) | `src/platform/core/search/**`, `sort/**`, `filters/**` | — |
| **port-library** (opencode) | `src/platform/core/library/**` | — |
| **port-features** (opencode) | `src/platform/core/tierlists/**`, `stats/**`, `shuffle/**` | — |

## Контракты, на которых всё держится

- `src/platform/contracts/paths.ts` — канонический `%APPDATA%\Nora`.
  `BaseDirectory.AppData` запрещён для пользовательских данных.
- `src/platform/contracts/store.ts` — форма 11 JSON-сторов. Проверено на живом
  профиле: корневые ключи `version` + payload, у восьми файлов ещё
  `__internal__`, у `tierlists`/`cmr_stats`/`palettes` его нет и появиться не
  должно.

## Четыре правила из спайка (нарушение = откат)

1. Сканер читает только голову 256 КБ, никогда файл целиком.
2. Бинарные данные не ходят через `invoke` как `Vec<u8>`; обложки — путём через
   `nora://`.
3. URL трека только через `convertFileSrc(path, 'nora')`.
4. Повреждённый файл стора — ошибка, а не повод записать умолчания.
