import 'server-only';

import { readOptionalEnv, readRequiredEnv } from './env';

export type OwnerIdentity = {
  /** OWNER_NAME, trimmed. Required. */
  name: string;
  /** OWNER_NIF, trimmed. Required. */
  nif: string;
  /** OWNER_ADDRESS, trimmed, one line. Required. */
  address: string;
  /** CONTACT_EMAIL, trimmed; also the mailto: target. Required. */
  contactEmail: string;
  /** OWNER_REGISTRY, trimmed; null when unset, empty or whitespace. */
  registry: string | null;
};

/**
 * The site owner's identity for the legal pages. Configuration, not code: read
 * from the environment on every call, so a changed value needs a container
 * restart and not a rebuild. The first blank required variable, in the order
 * OWNER_NAME, OWNER_NIF, OWNER_ADDRESS, CONTACT_EMAIL, throws
 * `Error("<NAME> is not set")`; the message names the variable, never a value.
 * OWNER_REGISTRY is optional and gives `null` when blank.
 */
export function getOwnerIdentity(): OwnerIdentity {
  return {
    name: readRequiredEnv('OWNER_NAME'),
    nif: readRequiredEnv('OWNER_NIF'),
    address: readRequiredEnv('OWNER_ADDRESS'),
    contactEmail: readRequiredEnv('CONTACT_EMAIL'),
    registry: readOptionalEnv('OWNER_REGISTRY') ?? null,
  };
}
