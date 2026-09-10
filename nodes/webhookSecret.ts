import { IHookFunctions, IWebhookFunctions, NodeOperationError } from 'n8n-workflow';

/**
 * Read the webhook secret from the credential used by the trigger node.
 *
 * The secret is stored in the credential so that n8n keeps it encrypted at
 * rest. It is sent to Lime when the webhook is registered and used to verify
 * the HMAC signature of each incoming webhook request.
 *
 * @param context - The n8n hook or webhook context of the trigger node
 * @param credentialType - Name of the credential type holding the secret
 * @returns The webhook secret from the credential.
 *
 * @throws {NodeOperationError} If the credential has no webhook secret configured.
 *
 * @public
 * @group Utils
 */
export async function getWebhookSecret(
	context: IHookFunctions | IWebhookFunctions,
	credentialType: string,
): Promise<string> {
	const credentials = await context.getCredentials(credentialType);
	const webhookSecret = credentials.webhookSecret;
	if (typeof webhookSecret !== 'string' || webhookSecret === '') {
		throw new NodeOperationError(
			context.getNode(),
			'The credential has no Webhook Secret. Add one to the ' +
				'credential and re-activate the workflow.',
		);
	}
	return webhookSecret;
}
