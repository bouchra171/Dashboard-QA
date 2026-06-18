const { normalizeText } = require('./scenarioInterpreter');

function splitCompoundStep(value) {
  return String(value || '')
    .split(/\s+et\s+(?=checker|control|controle|verif|remplac|upload|ouvrir)/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isContextOnlyLine(value) {
  const normalized = normalizeText(value).replace(/[:：]+$/g, '').trim();
  if (!normalized) return true;
  if (/^(scenario teste|sc.nario test.|ensuite|puis|conclusion|objectif|resultat attendu|anomalie a confirmer|preuves attendues|donnees a utiliser|commentaire libre)$/.test(normalized)) return true;
  if (/^(a|.) ce stade/.test(normalized)) return true;
  if (/^le probleme ne semble pas provenir/.test(normalized)) return true;
  return false;
}

function splitScenarioText(text) {
  const raw = String(text || '')
    .replace(/\r/g, '\n')
    .replace(/(?:^|\n)\s*(\d+)[.)]\s+/g, '\n$1. ')
    .trim();
  if (!raw) return [];

  const numbered = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^\d+[.)]\s+/.test(line))
    .map((line) => line.replace(/^\d+[.)]\s+/, '').trim())
    .flatMap(splitCompoundStep)
    .filter((line) => !isContextOnlyLine(line))
    .filter(Boolean);
  if (numbered.length) return numbered;

  return raw
    .split(/\b(?:puis|ensuite|apres|et ensuite|faire ensuite)\b|,\s*(?=valid|control|controle|checker|verif|remplac|upload|ouvrir)|[.;\n]+/i)
    .map((part) => part.trim())
    .flatMap(splitCompoundStep)
    .filter((part) => !isContextOnlyLine(part))
    .filter((part) => part.length > 3);
}

function inferMissingSteps(steps, fullText) {
  const normalized = normalizeText(fullText);
  const result = [...steps];
  const hasOpen = result.some((step) => /ouvrir|formulaire|newform/.test(normalizeText(step.text)));
  const hasPage1 = result.some((step) => /etape\s*0?1|page\s*1|validation.*1|valider.*1/.test(normalizeText(step.text)));
  const hasDocs = result.some((step) => /upload|depos|pj|piece|document/.test(normalizeText(step.text)));
  const hasUpload = result.some((step) => /upload|depos|televers|charger/.test(normalizeText(step.text)));
  const hasReplace = result.some((step) => /remplac|changer|modifier|nouvelle/.test(normalizeText(step.text)));
  const hasEudonet = result.some((step) => /eudonet|controle|checker|verifier/.test(normalizeText(step.text)));

  const prefix = [];
  if (!hasOpen && /newform|formulaire|candidature|msc|bachelor|pj|piece|document|eudonet/.test(normalized)) {
    prefix.push({ text: 'Ouvrir le formulaire NewForm cible', inferred: true });
  }
  if (!hasPage1 && /etape\s*0?2|page\s*2|pj|piece|document/.test(normalized)) {
    prefix.push({ text: "Completer et valider l'etape 1", inferred: true });
  }
  if ((!hasDocs || (hasReplace && !hasUpload)) && /remplac|eudonet.*pj|piece justificative|pj|document/.test(normalized)) {
    prefix.push({ text: "Uploader les pieces justificatives obligatoires a l'etape 2", inferred: true });
  }
  if (!hasEudonet && /lien|telechargement|download/.test(normalized)) {
    result.push({ text: 'Controler les pieces justificatives dans Eudonet', inferred: true });
  }

  return [...prefix, ...result];
}

function parseScenarioText(text) {
  const splitSteps = removeIntroSummaryStep(splitScenarioText(text));
  const initialSteps = splitSteps.map((stepText) => ({
    text: stepText,
    inferred: false,
  }));
  const steps = inferMissingSteps(initialSteps, text);
  return steps.map((step, index) => ({
    order: index + 1,
    text: step.text,
    normalizedText: normalizeText(step.text),
    inferred: Boolean(step.inferred),
  }));
}

function removeIntroSummaryStep(steps) {
  if (!Array.isArray(steps) || steps.length < 6) return steps;
  const firstThree = steps.slice(0, 3).map((step) => normalizeText(step)).join(' ');
  const hasDetailedStart = steps.slice(3).some((step) => /formulaire|validation.*1|upload|pj obligatoires/.test(normalizeText(step)));
  if (hasDetailedStart && /remplac/.test(firstThree) && /valid/.test(firstThree) && /eudonet|checker|controle/.test(firstThree)) {
    return steps.slice(3);
  }
  const first = normalizeText(steps[0]);
  const actionHints = [
    /remplac/,
    /valid/,
    /checker|controle|verif|eudonet/,
    /upload|pj|piece|document/,
  ].filter((pattern) => pattern.test(first)).length;
  return actionHints >= 3 ? steps.slice(1) : steps;
}

module.exports = {
  parseScenarioText,
  splitScenarioText,
};
