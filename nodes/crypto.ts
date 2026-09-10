import { createHmac } from 'node:crypto';

/**
 * Generate an HMAC SHA-256 hash for the given data using the provided key.
 *
 * @param key - The secret key used to generate the HMAC
 * @param data - The data to hash
 * @returns The generated HMAC string in the format `sha256=<digest>`.
 *
 * @internal
 * @group Utils
 */
function generateHmac(key: string, data: Buffer): string {
	return 'sha256=' + createHmac('sha256', key).update(data).digest('hex');
}

/**
 * Verify that a given HMAC matches the expected value for the provided data and key.
 *
 * @param key - The secret key used to generate the HMAC
 * @param data - The data to verify against
 * @param comparedHmac - The HMAC value to compare with
 *
 * @returns `true` if the HMAC matches, otherwise `false`.
 *
 * @public
 * @group Utils
 */
export function verifyHmac(key: string, data: Buffer, comparedHmac: string): boolean {
	return generateHmac(key, data) === comparedHmac;
}
