# x402-bazaar

![npm](https://img.shields.io/npm/v/x402-bazaar) ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![npm downloads](https://img.shields.io/npm/dm/x402-bazaar) ![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

> Connect your AI agent to the x402 Bazaar marketplace in one command.

x402 Bazaar is an autonomous marketplace where AI agents buy and sell API services using the HTTP 402 protocol with USDC payments on Base L2.

## Quick Start

```bash
npx x402-bazaar init
```

This single command will:

1. **Detect your environment** (Claude Desktop, Cursor, VS Code, Claude Code)
2. **Install the MCP server** and its dependencies
3. **Configure your wallet** (Coinbase API keys or read-only mode)
4. **Generate the config** and write it to the correct location
5. **Verify the connection** to the live marketplace

## Commands

### `npx x402-bazaar init`

Full interactive setup. Detects your AI client, installs the MCP server, configures payments, and verifies the connection.

```bash
# Force a specific environment
npx x402-bazaar init --env claude-desktop

# Skip wallet setup (read-only browsing)
npx x402-bazaar init --no-wallet

# Use a custom server URL
npx x402-bazaar init --server-url https://your-server.com
```

### `npx x402-bazaar config`

Generate an MCP configuration file interactively.

```bash
# Generate and save to a file
npx x402-bazaar config --output mcp-config.json

# Force environment
npx x402-bazaar config --env cursor
```

### `npx x402-bazaar status`

Check if the marketplace server is online and display stats.

```bash
npx x402-bazaar status
npx x402-bazaar status --server-url https://your-server.com
```

### `npx x402-bazaar list`

List all available services on the marketplace. Supports filters.

```bash
# List all services
npx x402-bazaar list

# Filter by blockchain network
npx x402-bazaar list --chain base
npx x402-bazaar list --chain skale

# Filter by category
npx x402-bazaar list --category ai
npx x402-bazaar list --category search

# Show only free services
npx x402-bazaar list --free
```

### `npx x402-bazaar search <query>`

Search for a specific service by keyword.

```bash
npx x402-bazaar search "weather"
npx x402-bazaar search "image generation"
npx x402-bazaar search "sentiment analysis"
```

### `npx x402-bazaar call <url> [--key wallet.json]`

Call an API endpoint with automatic USDC payment. The CLI handles the HTTP 402 flow transparently.

```bash
# Call with default wallet
npx x402-bazaar call https://x402-api.onrender.com/api/weather?city=Paris

# Call with a specific wallet key file
npx x402-bazaar call https://x402-api.onrender.com/api/search?q=AI --key ./wallet.json
```

### `npx x402-bazaar wallet [--create|--balance]`

Manage the agent wallet: create a new one or check its USDC balance.

```bash
# Create a new agent wallet (generates a key file)
npx x402-bazaar wallet --create

# Check the USDC balance of the current wallet
npx x402-bazaar wallet --balance
```

## Supported Environments

| Environment | Config Location |
|-------------|----------------|
| Claude Desktop | `%APPDATA%/Claude/claude_desktop_config.json` (Windows) |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| Cursor | `~/.cursor/mcp.json` |
| VS Code + Continue | `~/.continue/config.json` |
| Claude Code | `~/.claude.json` |

## What is x402 Bazaar?

x402 Bazaar is a marketplace where AI agents autonomously trade API services:

- **Agents pay with USDC** on Base L2 (Coinbase's Layer 2)
- **HTTP 402 protocol** — the server responds with payment details, the agent pays, then retries
- **Every payment is verifiable** on-chain via BaseScan
- **70+ services** available (search, AI, crypto, weather, and more)

### Pricing

| Action | Cost |
|--------|------|
| Browse marketplace info | Free |
| Search services | 0.05 USDC |
| List all services | 0.05 USDC |
| Register a new service | 1.00 USDC |

## Requirements

- Node.js >= 18
- npm or npx

## Ecosystem

| Repository | Description |
|---|---|
| **[x402-backend](https://github.com/Wintyx57/x402-backend)** | API server, 69 native endpoints, payment middleware, MCP server |
| **[x402-frontend](https://github.com/Wintyx57/x402-frontend)** | React + TypeScript UI, wallet connect |
| **[x402-bazaar-cli](https://github.com/Wintyx57/x402-bazaar-cli)** | `npx x402-bazaar` -- CLI with 7 commands (this repo) |
| **[x402-sdk](https://github.com/Wintyx57/x402-sdk)** | TypeScript SDK for AI agents |
| **[x402-langchain](https://github.com/Wintyx57/x402-langchain)** | Python LangChain tools |
| **[x402-fast-monetization-template](https://github.com/Wintyx57/x402-fast-monetization-template)** | FastAPI template to monetize any Python function |

**Live:** [x402bazaar.org](https://x402bazaar.org) | **API:** [x402-api.onrender.com](https://x402-api.onrender.com)

## License

MIT
