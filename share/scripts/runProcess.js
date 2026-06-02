const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { getProcess } = require('./processConfig');

const projectRoot = path.resolve(__dirname, '..');
const reportsRoot = path.join(projectRoot, 'reports', 'process');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowStamp(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function parseArgs(argv) {
  const result = {
    processId: 'candidature-to-edunote',
    from: '',
    until: '',
    schools: '',
    noPayment: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--process' && argv[index + 1]) {
      result.processId = argv[index + 1];
      index += 1;
    } else if (token === '--from' && argv[index + 1]) {
      result.from = argv[index + 1];
      index += 1;
    } else if (token === '--until' && argv[index + 1]) {
      result.until = argv[index + 1];
      index += 1;
    } else if (token === '--schools' && argv[index + 1]) {
      result.schools = argv[index + 1];
      index += 1;
    } else if (token === '--no-payment') {
      result.noPayment = true;
    } else if (token === '--dry-run') {
      result.dryRun = true;
    }
  }

  return result;
}

function selectSteps(processDefinition, options) {
  const steps = processDefinition.steps || [];
  let selected = steps;

  if (options.from) {
    const fromIndex = steps.findIndex((step) => step.id === options.from);
    if (fromIndex === -1) throw new Error(`Etape --from introuvable: ${options.from}`);
    selected = selected.slice(fromIndex);
  }

  if (options.until) {
    const untilIndex = selected.findIndex((step) => step.id === options.until);
    if (untilIndex === -1) throw new Error(`Etape --until introuvable: ${options.until}`);
    selected = selected.slice(0, untilIndex + 1);
  }

  return selected;
}

function buildStepArgs(step, options) {
  const args = Array.isArray(step.defaultArgs) ? [...step.defaultArgs] : [];
  if (step.id === 'front-candidature') {
    if (options.schools) args.push('--schools', options.schools);
    if (options.noPayment) args.push('--no-payment');
  }
  return args;
}

function runNodeStep(step, args) {
  return new Promise((resolve) => {
    const scriptPath = path.join(projectRoot, 'scripts', step.script);
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('close', (code) => resolve(code));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const processDefinition = getProcess(options.processId);
  const selectedSteps = selectSteps(processDefinition, options);
  const stamp = nowStamp();
  const summary = {
    createdAt: new Date().toISOString(),
    processId: processDefinition.id,
    processTitle: processDefinition.title,
    environment: processDefinition.environment,
    dryRun: options.dryRun,
    steps: [],
  };

  console.log(`=== Processus ${processDefinition.title} ===`);

  for (const step of selectedSteps) {
    const args = buildStepArgs(step, options);
    console.log('');
    console.log(`[STEP] ${step.id} - ${step.title}`);

    if (step.enabled === false || step.type === 'manual-placeholder') {
      const reason = step.reason || 'Etape non activee.';
      console.log(`[SKIP] ${reason}`);
      summary.steps.push({ id: step.id, title: step.title, status: 'SKIPPED', reason });
      continue;
    }

    if (options.dryRun) {
      console.log(`[DRY-RUN] node scripts/${step.script} ${args.join(' ')}`);
      summary.steps.push({ id: step.id, title: step.title, status: 'DRY_RUN', args });
      continue;
    }

    if (step.type !== 'node-script') {
      throw new Error(`Type d'etape non supporte: ${step.type}`);
    }

    const exitCode = await runNodeStep(step, args);
    summary.steps.push({
      id: step.id,
      title: step.title,
      status: exitCode === 0 ? 'OK' : 'KO',
      exitCode,
      args,
      produces: step.produces || [],
    });

    if (exitCode !== 0) {
      console.log(`[STOP] Etape en echec: ${step.id}`);
      break;
    }
  }

  ensureDir(reportsRoot);
  const summaryPath = path.join(reportsRoot, `process-summary-${stamp}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('');
  console.log(`[INFO] Resume processus: ${path.relative(projectRoot, summaryPath).replace(/\\/g, '/')}`);

  const hasFailure = summary.steps.some((step) => step.status === 'KO');
  if (hasFailure) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
