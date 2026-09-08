import {
    createCipheriv,
    createDecipheriv,
    createHmac,
    hkdfSync,
    randomBytes,
} from 'node:crypto';
import { NodeOperationError, INode } from 'n8n-workflow';

const ENCRYPTION_KEY_ENV = 'N8N_ENCRYPTION_KEY';
const HKDF_INFO = 'lime-webhook-secret';

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
export function verifyHmac(
    key: string,
    data: Buffer,
    comparedHmac: string
): boolean {
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
    data: Buffer
): void => {
    if (!limeSignature) {
        throw new NodeOperationError(
            node,
            'Webhook authentication failed, signature key is missing while secret is present!'
        );
    }

    const expectedHmac = generateHmac(webhookSecret, data);
    if (expectedHmac !== limeSignature) {
        throw new NodeOperationError(
            node,
            'Webhook authentication failed, signatures do not match'
        );
    }
};

/**
 * Retrieves the master encryption key from the environment variable.
 * Throws an error if the environment variable is not set.
 *
 * @return The master encryption key.
 */
const getMasterKey = (): string => {
    const key = process.env[ENCRYPTION_KEY_ENV];
    if (!key) {
        throw new Error(
            `${ENCRYPTION_KEY_ENV} must be set to manage Lime CRM webhooks`
        );
    }
    return key;
};

/**
 * Encrypts a plaintext string using AES-256-GCM with a derived key based on HKDF.
 *
 * @param plaintext - The plain text string to be encrypted.
 * @return The encrypted string encoded in base64 format.
 */
export const encryptSecret = (plaintext: string): string => {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = Buffer.from(
        hkdfSync('sha256', getMasterKey(), salt, HKDF_INFO, 32)
    );
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([salt, iv, tag, ct]).toString('base64');
};

/**
 * Decrypts a Base64-encoded secret using AES-256-GCM with key derivation.
 *
 * @param blob - The Base64-encoded string containing the encrypted data, including salt, IV, authentication tag, and ciphertext.
 * @return The decrypted data as a UTF-8 string.
 */
export const decryptSecret = (blob: string): string => {
    const buf = Buffer.from(blob, 'base64');
    const salt = buf.subarray(0, 16);
    const iv = buf.subarray(16, 28);
    const tag = buf.subarray(28, 44);
    const ct = buf.subarray(44);
    const key = Buffer.from(
        hkdfSync('sha256', getMasterKey(), salt, HKDF_INFO, 32)
    );
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
        'utf8'
    );
};
