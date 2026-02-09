# x402-bazaar

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

## Links

- Website: https://x402bazaar.org
- Dashboard: https://x402-api.onrender.com/dashboard
- GitHub: https://github.com/Wintyx57

## License

MIT
