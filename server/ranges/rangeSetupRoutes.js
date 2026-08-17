import express from 'express';

export const RANGE_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
export const RANGE_POSITIONS = ['UTG', 'HJ', 'BTN', 'SB'];
export const RANGE_HAND_NOTATIONS = RANGE_RANKS.flatMap((rowRank, rowIndex) => (
  RANGE_RANKS.map((columnRank, columnIndex) => {
    if (rowIndex === columnIndex) return `${rowRank}${columnRank}`;
    return rowIndex < columnIndex
      ? `${rowRank}${columnRank}s`
      : `${columnRank}${rowRank}o`;
  })
));

const isIntegerPercent = (value) => Number.isInteger(value) && value >= 0 && value <= 100;

const invalidSetup = (message) => {
  const error = new Error(message);
  error.code = 'RANGE_SETUP_INVALID';
  error.status = 400;
  return error;
};

const invalidVersion = (message) => {
  const error = new Error(message);
  error.code = 'RANGE_VERSION_INVALID';
  error.status = 400;
  return error;
};

const normalizeVersionName = (payload) => {
  const name = payload?.name;
  if (typeof name !== 'string' || !name.trim()) {
    throw invalidVersion('Nazwa wersji zakresów nie może być pusta.');
  }
  const normalizedName = name.trim();
  if (normalizedName.length > 120) {
    throw invalidVersion('Nazwa wersji zakresów może mieć maksymalnie 120 znaków.');
  }
  return normalizedName;
};

const versionNotFound = () => {
  const error = new Error('Wybrana wersja zakresów nie istnieje.');
  error.code = 'RANGE_VERSION_NOT_FOUND';
  error.status = 404;
  return error;
};

export const normalizeRangeSetup = (payload) => {
  const hands = payload?.hands;
  if (!hands || typeof hands !== 'object' || Array.isArray(hands)) {
    throw invalidSetup('Konfiguracja zakresów musi zawierać ręce.');
  }
  if (Object.keys(hands).length !== RANGE_HAND_NOTATIONS.length) {
    throw invalidSetup('Konfiguracja zakresów musi zawierać dokładnie 169 rąk.');
  }

  return {
    hands: Object.fromEntries(RANGE_HAND_NOTATIONS.map((notation) => {
      const positions = hands[notation];
      if (!positions || typeof positions !== 'object' || Array.isArray(positions)
        || Object.keys(positions).length !== RANGE_POSITIONS.length
        || !RANGE_POSITIONS.every((position) => isIntegerPercent(positions[position]))) {
        throw invalidSetup(`Nieprawidłowe ustawienia dla ręki ${notation}.`);
      }
      return [notation, Object.fromEntries(RANGE_POSITIONS.map((position) => [position, positions[position]]))];
    })),
  };
};

const sendError = (response, error) => {
  response.status(error.status || 500).json({
    error: error.message || 'Nie udało się zapisać konfiguracji zakresów.',
    code: error.code || 'RANGE_SETUP_ERROR',
  });
};

export const createRangeSetupRouter = ({ repository } = {}) => {
  if (!repository) throw new Error('Router zakresów wymaga repozytorium.');
  const router = express.Router();

  const readPreflopState = async () => {
    const setup = await repository.getPreflopSetup();
    const versions = await repository.listPreflopVersions();
    const activeVersionId = await repository.getActivePreflopVersionId();
    return { setup, versions, activeVersionId };
  };

  router.get('/preflop', async (_request, response) => {
    try {
      response.json(await readPreflopState());
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/preflop/versions', async (_request, response) => {
    try {
      response.json({
        versions: await repository.listPreflopVersions(),
        activeVersionId: await repository.getActivePreflopVersionId(),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/preflop/versions/:versionId', async (request, response) => {
    try {
      const version = await repository.getPreflopSetup(request.params.versionId);
      if (!version) throw versionNotFound();
      response.json({ setup: version });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.put('/preflop/active', async (request, response) => {
    try {
      const versionId = request.body?.versionId;
      if (typeof versionId !== 'string' || !versionId.trim()) {
        throw invalidVersion('Wybór wersji zakresów wymaga identyfikatora wersji.');
      }
      const setup = await repository.setActivePreflopVersion(versionId.trim());
      if (!setup) throw versionNotFound();
      response.json({
        setup,
        activeVersionId: setup.id,
        versions: await repository.listPreflopVersions(),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.patch('/preflop/versions/:versionId', async (request, response) => {
    try {
      const name = normalizeVersionName(request.body);
      const setup = await repository.renamePreflopVersion(request.params.versionId, name);
      if (!setup) throw versionNotFound();
      response.json({ setup });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/preflop/versions/:versionId/copy', async (request, response) => {
    try {
      const setup = await repository.copyPreflopVersion(request.params.versionId);
      if (!setup) throw versionNotFound();
      response.status(201).json({
        setup,
        activeVersionId: setup.id,
        versions: await repository.listPreflopVersions(),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.delete('/preflop/versions/:versionId', async (request, response) => {
    try {
      const result = await repository.deletePreflopVersion(request.params.versionId);
      if (!result) throw versionNotFound();
      response.json({
        ...result,
        versions: await repository.listPreflopVersions(),
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.put('/preflop', async (request, response) => {
    try {
      const setup = await repository.savePreflopSetup(normalizeRangeSetup(request.body));
      if (!setup) throw versionNotFound();
      response.json({ setup });
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
};
