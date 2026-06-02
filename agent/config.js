const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadConfig() {
  const fileEnv = parseEnvFile(path.join(projectRoot, '.env'));
  return {
    ...fileEnv,
    ...process.env,
  };
}

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const raw = token.slice(2);
    const eq = raw.indexOf('=');
    if (eq !== -1) {
      args[raw.slice(0, eq)] = raw.slice(eq + 1).replace(/^"|"$/g, '');
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[raw] = argv[index + 1];
      index += 1;
    } else {
      args[raw] = true;
    }
  }
  const npmAliases = {
    latest: { name: 'latest', boolean: true },
    lot: { name: 'lot' },
    lotId: { name: 'lotid' },
    env: { name: 'env' },
    environment: { name: 'environment' },
    campaign: { name: 'campaign' },
    campaignName: { name: 'campaignname' },
    campagne: { name: 'campagne' },
    scenario: { name: 'scenario' },
    scenarioId: { name: 'scenarioid' },
    dryRun: { name: 'dry_run', boolean: true },
    'dry-run': { name: 'dry_run', boolean: true },
  };
  for (const [argName, meta] of Object.entries(npmAliases)) {
    const value = process.env[`npm_config_${meta.name}`];
    if (args[argName] === undefined && value !== undefined) {
      if (meta.boolean) {
        args[argName] = value === 'true' ? true : value;
      } else if (value !== 'true' && value !== 'false') {
        args[argName] = value;
      }
    }
  }
  applyPositionalFallback(args, positional);
  return args;
}

function applyPositionalFallback(args, positional) {
  const values = positional.map((value) => String(value || '').trim()).filter(Boolean);
  if (!values.length) return;

  if (!args.env && !args.environment && /^(recette|preprod|préprod)$/i.test(values[0])) {
    args.env = values.shift();
  }

  if (!args.campaign && !args.campaignName && !args.campagne && values.length) {
    const testIndex = values.findIndex((value) => /^test$/i.test(value));
    if (testIndex !== -1 && /^auto$/i.test(values[testIndex + 1] || '')) {
      args.campagne = values.slice(0, testIndex + 2).join(' ');
      values.splice(0, testIndex + 2);
    } else {
      args.campagne = values.shift();
    }
  }

  if (!args.scenario && !args.scenarioId && values.length) {
    args.scenario = values.join(' ');
  }
}

function splitCsv(value, fallback = []) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

module.exports = {
  loadConfig,
  parseArgs,
  projectRoot,
  splitCsv,
};
