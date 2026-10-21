import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOwnerIdentity } from '@/config/owner';

// Obviously fake values only. The real identity lives in the developer's .env
// and never enters a test.
const FAKE = {
  OWNER_NAME: 'Titular de Prueba S.L.',
  OWNER_NIF: 'B00000000',
  OWNER_ADDRESS: 'Calle Falsa 123, 28000 Madrid',
  OWNER_REGISTRY: 'Registro de prueba, tomo 1, folio 1',
  CONTACT_EMAIL: 'contacto@example.test',
} as const;

function stubAll(overrides: Partial<Record<keyof typeof FAKE, string | undefined>> = {}) {
  for (const [name, value] of Object.entries({ ...FAKE, ...overrides })) {
    vi.stubEnv(name, value);
  }
}

beforeEach(() => {
  stubAll();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getOwnerIdentity', () => {
  it('returns the five configured values', () => {
    expect(getOwnerIdentity()).toEqual({
      name: FAKE.OWNER_NAME,
      nif: FAKE.OWNER_NIF,
      address: FAKE.OWNER_ADDRESS,
      contactEmail: FAKE.CONTACT_EMAIL,
      registry: FAKE.OWNER_REGISTRY,
    });
  });

  it('trims surrounding whitespace on every value', () => {
    stubAll({
      OWNER_NAME: '  Titular de Prueba S.L. ',
      OWNER_NIF: '\tB00000000 ',
      OWNER_ADDRESS: ' Calle Falsa 123, 28000 Madrid  ',
      CONTACT_EMAIL: ' contacto@example.test\n',
      OWNER_REGISTRY: '  Registro de prueba, tomo 1, folio 1 ',
    });
    expect(getOwnerIdentity()).toEqual({
      name: FAKE.OWNER_NAME,
      nif: FAKE.OWNER_NIF,
      address: FAKE.OWNER_ADDRESS,
      contactEmail: FAKE.CONTACT_EMAIL,
      registry: FAKE.OWNER_REGISTRY,
    });
  });

  it('reads the environment on every call, not at module load', () => {
    expect(getOwnerIdentity().name).toBe(FAKE.OWNER_NAME);
    vi.stubEnv('OWNER_NAME', 'Otro Titular de Prueba');
    expect(getOwnerIdentity().name).toBe('Otro Titular de Prueba');
  });

  describe.each(['OWNER_NAME', 'OWNER_NIF', 'OWNER_ADDRESS', 'CONTACT_EMAIL'] as const)(
    'required %s',
    (name) => {
      it('throws naming the variable when unset', () => {
        stubAll({ [name]: undefined });
        expect(() => getOwnerIdentity()).toThrow(new Error(`${name} is not set`));
      });

      it.each(['', '   ', '\t\n'])('throws naming the variable when blank (%j)', (blank) => {
        stubAll({ [name]: blank });
        expect(() => getOwnerIdentity()).toThrow(new Error(`${name} is not set`));
      });

      it('never puts another configured value in the error', () => {
        stubAll({ [name]: '' });
        let message = '';
        try {
          getOwnerIdentity();
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        expect(message).toBe(`${name} is not set`);
        for (const [other, value] of Object.entries(FAKE)) {
          if (other !== name) expect(message).not.toContain(value);
        }
      });
    },
  );

  it('names the first blank variable in the order name, NIF, address, email', () => {
    stubAll({ CONTACT_EMAIL: '', OWNER_ADDRESS: '', OWNER_NIF: '', OWNER_NAME: '' });
    expect(() => getOwnerIdentity()).toThrow(new Error('OWNER_NAME is not set'));
    vi.stubEnv('OWNER_NAME', FAKE.OWNER_NAME);
    expect(() => getOwnerIdentity()).toThrow(new Error('OWNER_NIF is not set'));
    vi.stubEnv('OWNER_NIF', FAKE.OWNER_NIF);
    expect(() => getOwnerIdentity()).toThrow(new Error('OWNER_ADDRESS is not set'));
    vi.stubEnv('OWNER_ADDRESS', FAKE.OWNER_ADDRESS);
    expect(() => getOwnerIdentity()).toThrow(new Error('CONTACT_EMAIL is not set'));
  });

  describe('optional OWNER_REGISTRY', () => {
    it('is null when unset', () => {
      stubAll({ OWNER_REGISTRY: undefined });
      expect(getOwnerIdentity().registry).toBeNull();
    });

    it.each(['', '   ', '\t\n'])('is null, not an empty string, when blank (%j)', (blank) => {
      stubAll({ OWNER_REGISTRY: blank });
      expect(getOwnerIdentity().registry).toBeNull();
    });

    it('does not stop the other four values from being read', () => {
      stubAll({ OWNER_REGISTRY: '' });
      expect(getOwnerIdentity()).toMatchObject({
        name: FAKE.OWNER_NAME,
        nif: FAKE.OWNER_NIF,
        address: FAKE.OWNER_ADDRESS,
        contactEmail: FAKE.CONTACT_EMAIL,
      });
    });
  });
});
