async function runIris(executionPlan) {
  return {
    application: 'iris',
    status: 'Bloque',
    lastStep: 'Non implemente',
    error: `Runner IRIS non branche pour le scenario ${executionPlan.scenarioId}.`,
    evidence: {},
  };
}

module.exports = {
  runIris,
};
