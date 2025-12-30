import { describe, it, expect } from 'vitest';
import { validateEmail } from '../../workers/shared/utils/validation';

describe('validateEmail', () => {
  it('should return true for valid email addresses', () => {
    expect(validateEmail('test@example.com')).toBe(true);
    expect(validateEmail('user.name@domain.co.uk')).toBe(true);
    expect(validateEmail('user+alias@gmail.com')).toBe(true);
    expect(validateEmail('1234567890@example.com')).toBe(true);
    expect(validateEmail('x@y.z')).toBe(true);
  });

  it('should return false for invalid email addresses', () => {
    expect(validateEmail('')).toBe(false);
    expect(validateEmail('not-an-email')).toBe(false);
    expect(validateEmail('@missing-local.com')).toBe(false);
    expect(validateEmail('missing-domain@.com')).toBe(false);
    expect(validateEmail('spaces in@email.com')).toBe(false);
    expect(validateEmail('double@@at.com')).toBe(false);
  });

  it('should return false for non-string inputs', () => {
    // @ts-ignore
    expect(validateEmail(null)).toBe(false);
    // @ts-ignore
    expect(validateEmail(undefined)).toBe(false);
    // @ts-ignore
    expect(validateEmail(123)).toBe(false);
    // @ts-ignore
    expect(validateEmail({})).toBe(false);
  });
});
