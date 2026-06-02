const fs = require('fs');
const path = require('path');

const { projectRoot } = require('./config');

function readHistory() {
  const historyPath = path.join(projectRoot, 'data', 'anomalies-history.json');
  if (!fs.existsSync(historyPath)) return [];
  return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
}

function normalize(value) {
  return String(value || '').toLowerCase();
}

function scoreAnomaly(current, previous, scenario) {
  let score = 0;
  const reasons = [];
  if (normalize(previous.ecole) && normalize(scenario.ecole).includes(normalize(previous.ecole))) {
    score += 25;
    reasons.push('Même école ou famille école');
  }
  if (normalize(previous.page) === normalize(current.page)) {
    score += 25;
    reasons.push('Même page');
  }
  if (normalize(previous.fonctionnalite) === normalize(current.fonctionnalite)) {
    score += 20;
    reasons.push('Même fonctionnalité');
  }
  const currentKeywords = new Set((current.keywords || []).map(normalize));
  const commonKeywords = (previous.keywords || []).filter((keyword) => currentKeywords.has(normalize(keyword)));
  if (commonKeywords.length) {
    score += Math.min(25, commonKeywords.length * 8);
    reasons.push(`Mots-clés similaires: ${commonKeywords.join(', ')}`);
  }
  if (/ouverte|en cours|nouvelle/i.test(previous.statut || '')) {
    score += 5;
    reasons.push('Anomalie historique ouverte');
  }
  return { score, reasons };
}

function classify(current, scenario) {
  const history = readHistory();
  if (!history.length) {
    return {
      classification: 'Nouvelle anomalie',
      anomalieRapprochee: null,
      score: 0,
      raisons: ['Historique anomalies vide'],
    };
  }

  const matches = history
    .map((item) => ({ item, ...scoreAnomaly(current, item, scenario) }))
    .sort((left, right) => right.score - left.score);
  const best = matches[0];

  if (!best || best.score < 40) {
    return {
      classification: 'Nouvelle anomalie',
      anomalieRapprochee: best?.item || null,
      score: best?.score || 0,
      raisons: best?.raisons || [],
    };
  }

  if (matches.filter((item) => item.score >= 60).length > 1) {
    return {
      classification: 'Doublon possible',
      anomalieRapprochee: best.item,
      score: best.score,
      raisons: best.raisons,
    };
  }

  if (best.score < 60) {
    return {
      classification: 'À analyser',
      anomalieRapprochee: best.item,
      score: best.score,
      raisons: best.raisons,
    };
  }

  return {
    classification: /corrig/i.test(best.item.statut || '') ? 'Suspicion de régression' : 'Anomalie connue',
    anomalieRapprochee: best.item,
    score: best.score,
    raisons: best.raisons,
  };
}

module.exports = {
  classify,
};
