- Fixed: importing settings that include `display.themeMode` no longer prints an "unknown key" warning. The key is now declared in the platform configuration schema, so every component that reads `settings.json` — this Agent, the daemon's CLI, the terminal app — ingests it as a real, documented setting instead of loudly skipping it on every boot.
- Changed: the settings modal's `display.themeMode` row now comes from that schema like every other `display.*` key. The hand-built local descriptor the modal carried for it — needed only while the schema did not declare the key — is gone, along with the special-casing that re-coerced its value on every refresh.
- Changed: the schema entry documents what the modes actually do. `auto` probes the terminal background colour once at startup and picks light or dark to match; `dark` and `light` force a fixed appearance regardless of terminal background. The mode is independent of `display.theme`, which picks the colour palette.
- Changed: the bundled GoodVibes platform runtime is 2.0.1.
- Changed: the daemon this Agent installs alongside itself is 1.28.3, the daemon build carrying the same schema declaration.

GoodVibes Agent 2.0.1 - 2026-08-01
