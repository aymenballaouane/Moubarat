import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api.js';
import { bootFailureAction } from '../src/lib/bootSession.js';

describe('MS-040 — une panne au démarrage ne déconnecte pas', () => {
  it('réseau coupé ou serveur en erreur : la session est gardée et réessayée', () => {
    expect(bootFailureAction(new ApiError(0, 'NETWORK_ERROR', 'x'))).toBe('retry');
    expect(bootFailureAction(new ApiError(502, 'BAD_GATEWAY', 'x'))).toBe('retry');
    expect(bootFailureAction(new ApiError(503, 'DRAINING', 'x'))).toBe('retry');
  });
  it('session refusée ou réponse inattendue : la session est jetée', () => {
    expect(bootFailureAction(new ApiError(401, 'UNAUTHORIZED', 'x'))).toBe('drop');
    expect(bootFailureAction(new ApiError(403, 'FORBIDDEN', 'x'))).toBe('drop');
    expect(bootFailureAction(new Error('autre'))).toBe('drop');
  });
});
