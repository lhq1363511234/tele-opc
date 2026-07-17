import { describe, expect, it } from 'vitest';
import { isOwnerAllowed } from '../src/auth/ownerAllowlist.js';

describe('isOwnerAllowed', () => {
  it('allows configured telegram owners', () => {
    expect(isOwnerAllowed({ id: 123, first_name: 'Cir' }, [123])).toBe(true);
  });

  it('rejects unknown users', () => {
    expect(isOwnerAllowed({ id: 456, first_name: 'Other' }, [123])).toBe(false);
  });

  it('rejects missing users', () => {
    expect(isOwnerAllowed(undefined, [123])).toBe(false);
  });
});

