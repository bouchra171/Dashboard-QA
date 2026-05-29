const http = require('http');
const { spawn } = require('child_process');

const healthUrl = process.argv[2] || 'http://127.0.0.1:4173/api/health';
const dashboardUrl = process.argv[3] || 'http://127.0.0.1:4173/';
const timeoutMs = Number(process.env.QA_DASHBOARD_TIMEOUT_MS || 60000);
const intervalMs = 1000;
const deadline = Date.now() + timeoutMs;

function checkHealth(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 2500 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });

    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

function openDashboard(url) {
  const child = spawn('cmd', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function main() {
  while (Date.now() < deadline) {
    if (await checkHealth(healthUrl)) {
      openDashboard(dashboardUrl);
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.error(`Le dashboard n'a pas repondu apres ${Math.round(timeoutMs / 1000)} secondes.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
