# UnderFlow

A modern flowchart editor built with React and Tauri.

## Features

- **Node Types** — Process, Input, Output, Condition (Diamond)
- **Inline Editing** — Double-click any node or edge label to edit
- **Color System** — Hollow (border-only) and solid (filled) color presets with custom color picker
- **Border Styles** — Solid or dashed border options
- **Auto Layout** — One-click ELK-based layered graph layout
- **Export** — Export as SVG or PNG with native save dialog
- **Save/Open** — Save and load flowchart JSON files (desktop app)
- **Background Settings** — Configurable dots, lines, or cross patterns with adjustable gap and size

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript |
| Flow Engine | @xyflow/react 12 |
| Layout | ELK.js |
| Desktop | Tauri 2 |
| Build | Vite 8 |

## Project Structure

```
UnderFlow/
├── src/
│   ├── front/                  # React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   └── FlowchartApp/
│   │   │   │       └── index.tsx    # Main flowchart component
│   │   │   ├── lib/
│   │   │   │   └── tauri.ts         # Tauri IPC wrappers
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── tauri/                  # Tauri backend
│       ├── src/
│       │   └── main.rs         # Rust commands
│       ├── icons/              # App icons
│       ├── tauri.conf.json
│       └── Cargo.toml
├── README.md
└── createspace-DESIGN.md
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/)
- [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
# Install dependencies
cd src/front && pnpm install

# Start dev server (browser)
pnpm dev

# Start Tauri desktop app
pnpm tauri:dev
```

### Build

```bash
# Build desktop app
cd src/front && pnpm tauri:build
```

Output:
- `src/front/src-tauri/target/release/bundle/msi/UnderFlow_1.0.0_x64_en-US.msi`
- `src/front/src-tauri/target/release/bundle/nsis/UnderFlow_1.0.0_x64-setup.exe`

## License

MIT
