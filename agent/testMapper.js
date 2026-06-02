const fs = require('fs');
const path = require('path');

const { projectRoot } = require('./config');

function readMapping() {
  const mappingPath = path.join(projectRoot, 'mapping', 'squash-playwright-map.json');
  if (!fs.existsSync(mappingPath)) return {};
  return JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
}

function isAutomatedStatus(value) {
  const text = String(value || '');
  return !/^non\b/i.test(text.trim()) && /automatis|automated/i.test(text);
}

function mapScenario(scenario, mapping) {
  const entry = mapping[scenario.ecole];
  if (!entry) {
    return {
      ...scenario,
      scriptPlaywright: '',
      schoolSlug: '',
      statutAutomatisation: 'Non automatise',
    };
  }

  const scriptPath = entry.scriptPlaywright || '';
  const absoluteScriptPath = scriptPath ? path.join(projectRoot, scriptPath) : '';
  const scriptExists = absoluteScriptPath ? fs.existsSync(absoluteScriptPath) : false;
  const automated = isAutomatedStatus(entry.statutAutomatisation) && scriptExists;

  return {
    ...scenario,
    scriptPlaywright: scriptPath,
    schoolSlug: entry.schoolSlug || '',
    statutAutomatisation: automated ? 'Automatise' : (entry.statutAutomatisation || 'Non automatise'),
    mappingTags: Array.isArray(entry.tags) ? entry.tags : [],
    mappingError: scriptPath && !scriptExists ? `Script introuvable: ${scriptPath}` : '',
  };
}

function mapScenarios(scenarios) {
  const mapping = readMapping();
  return scenarios.map((scenario) => mapScenario(scenario, mapping));
}

module.exports = {
  mapScenarios,
};
