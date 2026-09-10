import {
	ICredentialDataDecryptedObject,
	ICredentialTestFunctions,
	ICredentialsDecrypted,
	INodeCredentialTestResult,
} from 'n8n-workflow';

/**
 * Minimum accepted length of the webhook secret.
 *
 * @internal
 * @group Utils
 */
const MIN_WEBHOOK_SECRET_LENGTH = 32;

/**
 * Remove trailing slashes from a URL.
 *
 * @param url - The URL to normalize
 * @returns The URL without trailing slashes.
 *
 * @internal
 * @group Utils
 */
const stripTrailingSlashes = (url: string): string => {
	let end = url.length;
	while (end > 0 && url[end - 1] === '/') {
		end--;
	}
	return url.slice(0, end);
};

/**
 * Validate the optional webhook secret of a credential.
 *
 * The secret is only needed by trigger nodes, so an empty field is fine.
 * A short value is not blocked anywhere, but it weakens the webhook
 * signatures, so recommend a longer one when the credential is tested.
 *
 * @param data - The decrypted credential data
 * @returns An error result when the secret is set but too short, otherwise `null`.
 *
 * @internal
 * @group Utils
 */
const validateWebhookSecret = (
	data: ICredentialDataDecryptedObject,
): INodeCredentialTestResult | null => {
	const webhookSecret = data.webhookSecret;
	if (
		typeof webhookSecret === 'string' &&
		webhookSecret !== '' &&
		webhookSecret.length < MIN_WEBHOOK_SECRET_LENGTH
	) {
		return {
			status: 'Error',
			message:
				`The Webhook Secret is shorter than the recommended ` +
				`${MIN_WEBHOOK_SECRET_LENGTH} characters. Consider a ` +
				`stronger value, e.g. generated with "openssl rand -hex 32"`,
		};
	}
	return null;
};

/**
 * Credential test for the Lime CRM API credential.
 *
 * Validates the optional webhook secret locally and verifies the server URL
 * and API key by pinging the Lime CRM API.
 *
 * @param credential - The decrypted credential to test
 * @returns The test result shown in the credential modal.
 *
 * @public
 * @group Utils
 */
export async function limeCrmApiTest(
	this: ICredentialTestFunctions,
	credential: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
	const data = credential.data ?? {};

	const invalidSecret = validateWebhookSecret(data);
	if (invalidSecret) {
		return invalidSecret;
	}

	try {
		await this.helpers.request({
			method: 'GET',
			uri: `${stripTrailingSlashes(data.url as string)}/api/v1/`,
			json: true,
			headers: {
				'X-API-Key': data.apiKey,
				Accept: 'application/json',
			},
		});
	} catch (error) {
		return {
			status: 'Error',
			message: `Connection failed: ${error.message}`,
		};
	}

	return { status: 'OK', message: 'Connection successful' };
}

/**
 * Credential test for the Lime CRM Forms API credential.
 *
 * Validates the optional webhook secret locally and verifies the server URL
 * and API key by pinging the Lime Forms API.
 *
 * @param credential - The decrypted credential to test
 * @returns The test result shown in the credential modal.
 *
 * @public
 * @group Utils
 */
export async function limeFormsApiTest(
	this: ICredentialTestFunctions,
	credential: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
	const data = credential.data ?? {};

	const invalidSecret = validateWebhookSecret(data);
	if (invalidSecret) {
		return invalidSecret;
	}

	try {
		await this.helpers.request({
			method: 'GET',
			uri: `${stripTrailingSlashes(data.url as string)}/api/v1/external-integrations/ping`,
			json: true,
			headers: {
				Authorization: `Bearer ${data.apiKey}`,
				Accept: 'application/json',
			},
		});
	} catch (error) {
		return {
			status: 'Error',
			message: `Connection failed: ${error.message}`,
		};
	}

	return { status: 'OK', message: 'Connection successful' };
}
