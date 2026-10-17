# ChemScan Companion

A small always-on-top Windows companion for the ChemScan LCA. Pick the sample's state
and type, enter its weight and the LCA version, and it shows the instrument settings.

## Rules

| Setting | Rule |
| --- | --- |
| Ion size | Liquid 2.0. Solid 6.0, or 3.5 if organic. Gas must not exceed 1.3 (shown as max). |
| Delta V | Weight (g) x 250 if organic, x 100 if inorganic. |
| Threshold | Liquid delta V / 3, solid delta V / 2, gas delta V x 2. |
| Matrix size | 5, or 4 on LCA version 1.03 or lower. |

Rules live in `src-tauri/src/rules.rs` with unit tests. Versions compare segment by
segment, so `1.1` counts as below `1.03` and `1.10` as above it.

## Window

- Frameless corner panel, bottom-right of the screen on first launch.
- Pin button toggles always-on-top (on by default).
- The circle button shrinks it to a round bubble that stays on top. Drag the bubble
  anywhere; click it to reopen. Both positions are remembered.
- Click a result to copy it.
- It can sit over windowed and borderless-fullscreen apps, not exclusive fullscreen.

## Develop

```
npm install
npm run tauri dev
npm test              # cargo unit tests for the rules
npm run tauri build   # exe + NSIS installer in src-tauri/target/release
```
