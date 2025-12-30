/**
 * Validation utilities
 */

/**
 * Validates whether the given string is a valid email address.
 * 
 * This uses a standard regular expression for general email validation.
 * It checks for:
 * - Presence of @ and .
 * - No spaces
 * - Standard characters in local and domain parts
 * 
 * @param email - The email address to validate
 * @returns True if the email is valid, false otherwise
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }
  
  // Standard email regex that covers most use cases
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  return emailRegex.test(email);
}
