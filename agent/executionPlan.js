const { parseScenarioText } = require('./scenarioParser');
const { mapStepsToActions } = require('./actionMapper');
const { interpretFreeformScenario } = require('./scenarioInterpreter');

function mergeActionFlags(steps) {
  const actions = {
    createCandidate: false,
    uniqueEmail: false,
    uploadDocuments: false,
    replaceDocument: false,
    validateStep2: false,
    modifyPersonalInfo: false,
    validateStep3: false,
    checkEudonet: false,
    verifyDownloadLinks: false,
    checkpoints: [],
  };
  const checkpointIds = new Set();

  for (const step of steps) {
    if (!step.supported) continue;
    const flags = step.flags || {};
    for (const key of ['createCandidate', 'uniqueEmail', 'uploadDocuments', 'replaceDocument', 'validateStep2', 'modifyPersonalInfo', 'validateStep3', 'checkEudonet', 'verifyDownloadLinks']) {
      if (flags[key] === true) actions[key] = true;
    }
    if (flags.checkpoint && !checkpointIds.has(flags.checkpoint.id)) {
      checkpointIds.add(flags.checkpoint.id);
      actions.checkpoints.push(flags.checkpoint);
    }
  }

  if (actions.replaceDocument) actions.uploadDocuments = true;
  if (actions.checkEudonet && actions.checkpoints.length === 0) {
    actions.checkpoints.push({ id: 'documents-uploaded-before-validation', label: 'controle Eudonet' });
  }
  return actions;
}

function scenarioTextFromConfig(config = {}) {
  const manual = config.manualScenario || {};
  const titleText = String(manual.title || config.scenario || '').trim();
  const titleLooksLikeScenario = /\b(remplac|valid|upload|controle|checker|eudonet|pj|piece|document|etape|page)\b/i.test(titleText) || titleText.length > 90;
  const detailParts = [];
  const seenParts = new Set();
  for (const part of [
    manual.description,
    manual.scenarioText,
    manual.dataToUse,
    manual.expectedResult,
    manual.eudonetControl,
    manual.comment,
    config.customScenario,
  ]) {
    const value = String(part || '').trim();
    if (!value) continue;
    const normalized = value.replace(/\s+/g, ' ').toLowerCase();
    if (seenParts.has(normalized)) continue;
    seenParts.add(normalized);
    detailParts.push(value);
  }
  if (detailParts.length) return detailParts.join('\n');
  return titleLooksLikeScenario ? titleText : '';
}

function buildUnderstoodPlan(config = {}) {
  const text = scenarioTextFromConfig(config);
  const parsedSteps = parseScenarioText(text);
  const mappedSteps = normalizeOrderedActions(mapStepsToActions(parsedSteps));
  const unsupportedSteps = mappedSteps.filter((step) => !step.supported);
  const actions = mergeActionFlags(mappedSteps);
  const emptyReason = "Renseigne le scenario personnalise avant l'analyse. Aucun plan executable n'a ete detecte.";

  return {
    id: config.planId || `plan-${Date.now()}`,
    source: 'manual',
    title: config.manualScenario?.title || config.scenario || 'Scenario personnalise',
    summary: text.slice(0, 280),
    valid: mappedSteps.length > 0 && unsupportedSteps.length === 0,
    blockedReason: !mappedSteps.length
      ? emptyReason
      : unsupportedSteps.length
      ? "L'agent a detecte une etape non supportee. L'execution est bloquee afin d'eviter de lancer un mauvais parcours."
      : '',
    stats: {
      total: mappedSteps.length,
      supported: mappedSteps.filter((step) => step.supported).length,
      unsupported: unsupportedSteps.length,
    },
    steps: mappedSteps,
    actions,
  };
}

function normalizeOrderedActions(steps) {
  let seenValidateStep2 = false;
  return steps.map((step) => {
    if (step.actionId === 'validate_step2') seenValidateStep2 = true;
    if (seenValidateStep2 && /^check_eudonet_documents/.test(step.actionId || '')) {
      return {
        ...step,
        actionId: 'check_eudonet_documents_after_step2',
        actionLabel: "Controler Eudonet apres validation de l'etape 2",
        flags: {
          ...(step.flags || {}),
          checkEudonet: true,
          verifyDownloadLinks: true,
          checkpoint: { id: 'documents-after-step2-validation', label: 'apres validation de l etape 02' },
        },
      };
    }
    return step;
  });
}

function buildManualExecutionPlan(config = {}) {
  const understoodPlan = config.understoodPlan || buildUnderstoodPlan(config);
  if (!understoodPlan.valid) {
    const error = new Error(understoodPlan.blockedReason || 'Scenario personnalise non supporte.');
    error.code = 'UNSUPPORTED_SCENARIO_PLAN';
    error.understoodPlan = understoodPlan;
    throw error;
  }

  const executionPlan = interpretFreeformScenario(config);
  executionPlan.understoodPlan = understoodPlan;
  executionPlan.manualInstructions.actions = understoodPlan.actions;
  executionPlan.manualInstructions.steps = understoodPlan.steps;
  executionPlan.manualInstructions.rawText = scenarioTextFromConfig(config);
  executionPlan.target.apps = understoodPlan.actions.checkEudonet ? ['newform', 'eudonet'] : ['newform'];
  executionPlan.target.application = understoodPlan.actions.checkEudonet ? 'eudonet' : 'newform';
  return executionPlan;
}

module.exports = {
  buildUnderstoodPlan,
  buildManualExecutionPlan,
  mergeActionFlags,
  scenarioTextFromConfig,
};
