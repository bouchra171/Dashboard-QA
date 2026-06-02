function isIgnoredLot(lot) {
  const name = String(lot?.nomLot || '');
  return Boolean(lot?.ignore) || /^X\./i.test(name.trim()) || /Sujets Classés/i.test(name);
}

function listValidLots(payload) {
  return (payload?.lots || []).filter((lot) => !isIgnoredLot(lot));
}

function pickLatest(lots) {
  return lots[lots.length - 1] || null;
}

function selectLot(payload, options, config) {
  const lots = listValidLots(payload);
  const cliLotName = options.lot || '';
  const cliLotId = options.lotId || '';
  const environment = options.env || options.environment || config.SQUASH_ENVIRONMENT || 'Recette';
  let modeSelection = 'latest';
  let selected = null;

  if (cliLotId) {
    modeSelection = 'CLI id';
    selected = lots.find((lot) => String(lot.idLot) === String(cliLotId));
  } else if (cliLotName) {
    modeSelection = 'CLI name';
    selected = lots.find((lot) => String(lot.nomLot).toLowerCase() === String(cliLotName).toLowerCase());
  } else if (options.latest) {
    modeSelection = 'latest';
    selected = pickLatest(lots);
  } else {
    const mode = String(config.SQUASH_LOT_MODE || 'latest').toLowerCase();
    modeSelection = mode;
    if (mode === 'id') {
      selected = lots.find((lot) => String(lot.idLot) === String(config.SQUASH_LOT_ID || ''));
    } else if (mode === 'name') {
      selected = lots.find((lot) => String(lot.nomLot).toLowerCase() === String(config.SQUASH_LOT_NAME || '').toLowerCase());
    } else {
      selected = pickLatest(lots);
    }
  }

  if (!selected) {
    const available = lots.map((lot) => `${lot.idLot} - ${lot.nomLot}`).join(', ') || 'aucun lot valide';
    throw new Error(`Aucun lot Squash trouve pour la selection demandee. Lots disponibles: ${available}`);
  }

  return {
    ...selected,
    modeSelection,
    environnement: environment,
  };
}

module.exports = {
  listValidLots,
  selectLot,
};
