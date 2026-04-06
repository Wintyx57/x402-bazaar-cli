import ora from "ora";
import chalk from "chalk";
import { log } from "../utils/logger.js";

export async function statusCommand(options) {
  const serverUrl = options.serverUrl || "https://x402-api.onrender.com";

  log.banner();
  log.info(`Checking connection to ${chalk.bold(serverUrl)}`);
  log.separator();
  console.log("");

  // 1. Health check
  let healthOk = false;
  const spinner = ora("Checking /health endpoint...").start();
  try {
    const res = await fetch(`${serverUrl}/health`);
    const data = await res.json();
    spinner.succeed(`Server is online — Network: ${chalk.bold(data.network)}`);
    healthOk = true;
  } catch (err) {
    spinner.fail(`Cannot reach ${serverUrl}/health`);
    log.error(`  ${err.message}`);
    log.dim("  Make sure the server is running and the URL is correct.");
    console.log("");
    process.exit(1);
  }

  // 2. Root endpoint
  const spinner2 = ora("Fetching marketplace info...").start();
  try {
    const res = await fetch(serverUrl);
    const data = await res.json();
    spinner2.succeed(
      `${data.name} — ${chalk.bold(data.total_services)} services`,
    );
  } catch (err) {
    spinner2.fail(`Cannot fetch marketplace info: ${err.message}`);
  }

  // 3. Stats (from public endpoints — /api/stats requires admin auth)
  const spinner3 = ora("Fetching stats...").start();
  try {
    const res = await fetch(`${serverUrl}/api/services?limit=0`);
    const svcData = await res.json();
    const total = svcData.pagination?.total ?? svcData.data?.length ?? "?";
    const online = Array.isArray(svcData.data)
      ? svcData.data.filter((s) => s.status === "online").length
      : "?";
    spinner3.succeed("Stats loaded");
    console.log("");
    log.dim(`    Total services:  ${total}`);
    log.dim(`    Online:          ${online}`);
    log.dim(`    Free tier:       5 calls/day without wallet`);
    log.dim(`    Chains:          SKALE (gas-free), Base, Polygon`);
  } catch (err) {
    spinner3.fail(`Cannot fetch stats: ${err.message}`);
  }

  console.log("");
  log.separator();
  log.success(chalk.bold("x402 Bazaar is operational!"));
  log.dim(`  Dashboard: ${serverUrl}/dashboard`);
  log.dim(`  Website:   https://x402bazaar.org`);
  console.log("");
}
