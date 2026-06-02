async function runYpareo(executionPlan) {
  return {
    application: 'ypareo',
    status: 'Bloque',
    lastStep: 'Non implemente',
    error: `Runner YPAREO non branche pour le scenario ${executionPlan.scenarioId}.`,
    evidence: {},
  };
}

module.exports = {
  runYpareo,
};
