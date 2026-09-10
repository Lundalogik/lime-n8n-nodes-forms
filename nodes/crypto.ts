import { createHmac } from 'node:crypto';
import { NodeOperationError, INode } from 'n8n-workflow';

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

/**
 * Verifies the integrity and authenticity of a webhook request by validating
 * the `limeSignature` against the HMAC generated using the `webhookSecret` and the request `data`.
 *
 * Throws an error if:
 * - Both `webhookSecret` and `limeSignature` are missing.
 * - `webhookSecret` is missing while `limeSignature` is present.
 * - `limeSignature` is missing while `webhookSecret` is present.
 * - The `limeSignature` does not match the HMAC generated using the `webhookSecret`.
 *
 * @param node - The node where the verification is performed.
 * @param limeSignature - The signature included in the webhook request that needs to be verified.
 * @param webhookSecret - The secret key used to verify the signature of the webhook request.
 * @param data - The raw payload of the webhook request used for signature verification.
 * @throws {NodeOperationError} If verification of the request fails due to missing or invalid authentication data.
 */
export const verifyRequest = (
	node: INode,
	limeSignature: string,
	webhookSecret: string,
	data: Buffer,
): void => {
	if (!limeSignature) {
		throw new NodeOperationError(
			node,
			'Webhook authentication failed, signature key is missing while secret is present!',
		);
	}

	const expectedHmac = generateHmac(webhookSecret, data);
	if (expectedHmac !== limeSignature) {
		throw new NodeOperationError(node, 'Webhook authentication failed, signatures do not match');
	}
};
