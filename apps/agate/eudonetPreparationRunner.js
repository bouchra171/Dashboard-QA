const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { projectRoot } = require('../../agent/config');

const contactDataPath = path.join(projectRoot, 'share', 'data', 'eudonet', 'contact-test.json');
const usedContactPath = path.join(projectRoot, 'authentification', 'eudonet-contact-data-used.json');
const contactScriptPath = path.join(projectRoot, 'share', 'scripts', 'openEudonetNewContact.js');
const candidatureScriptPath = path.join(projectRoot, 'share', 'scripts', 'openEudonetNewCandidature.js');

function runCommand(scriptPath, args = [], env = process.env) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env,
      shell: false,
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(chunk);
    });
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

async function prepareEudonetForAgate(options = {}) {
  const env = {
    ...process.env,
    EUDONET_SUBMIT: '1',
    EUDONET_CANDIDATURE_SUBMIT: '1',
    KEEP_OPEN_MS: String(options.keepOpenMs ?? process.env.KEEP_OPEN_MS ?? 1000),
  };

  const contactArgs = ['--data', options.contactDataPath || contactDataPath, '--submit'];
  const contact = await runCommand(contactScriptPath, contactArgs, env);
  if (contact.exitCode !== 0) {
    return {
      application: 'eudonet',
      status: 'KO',
      lastStep: 'creation-contact',
      error: contact.stderr || contact.stdout,
      evidence: {
        log: 'authentification/eudonet-new-contact.log',
        screenshot: 'authentification/eudonet-new-contact.png',
      },
    };
  }

  const candidatureArgs = ['--contact', usedContactPath, '--submit'];
  const candidature = await runCommand(candidatureScriptPath, candidatureArgs, env);
  if (candidature.exitCode !== 0) {
    return {
      application: 'eudonet',
      status: 'KO',
      lastStep: 'creation-candidature',
      error: candidature.stderr || candidature.stdout,
      candidate: readJsonIfExists(usedContactPath),
      evidence: {
        log: 'authentification/eudonet-new-candidature.log',
        screenshot: 'authentification/eudonet-new-candidature-popup.png',
        candidateData: 'authentification/eudonet-contact-data-used.json',
      },
    };
  }

  return {
    application: 'eudonet',
    status: 'OK',
    lastStep: 'candidature-creee',
    error: '',
    candidate: readJsonIfExists(usedContactPath),
    evidence: {
      contactLog: 'authentification/eudonet-new-contact.log',
      candidatureLog: 'authentification/eudonet-new-candidature.log',
      contactScreenshot: 'authentification/eudonet-contact-created.png',
      candidatureScreenshot: 'authentification/eudonet-new-candidature-popup.png',
      candidateData: 'authentification/eudonet-contact-data-used.json',
    },
  };
}

module.exports = {
  prepareEudonetForAgate,
};
