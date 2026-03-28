import { ensureDashboardCache } from "../lib/server/dashboard-cache-groups.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextDelayMs() {
  const minutes = 55 + Math.floor(Math.random() * 11);
  return minutes * 60 * 1000;
}

async function main() {
  while (true) {
    try {
      await ensureDashboardCache();
    } catch (error) {
      console.error("Cache update failed:", error);
    }

    const delay = nextDelayMs();
    console.log(`Sleeping for ${Math.round(delay / 60000)} minutes before next update.`);
    await sleep(delay);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
