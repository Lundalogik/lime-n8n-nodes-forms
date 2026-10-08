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

/**
 * Read the secrets a delivery may be signed with: the webhook secret and,
 * while a rotation is in progress, the previous one.
 *
 * Lime signs with the secret a subscription was registered with. After the
 * credential is rotated, subscriptions keep the old secret until their
 * workflow is re-activated, so the previous secret has to be accepted for
 * them to keep working.
 *
 * @param context - The n8n hook or webhook context of the trigger node
 * @param credentialType - The credential type that holds the secrets
 * @returns The current secret first, then the previous one if it is set
 *
 * @throws {NodeOperationError} if the credential has no webhook secret
 *
 * @public
 * @group Utils
 */
export async function getWebhookSecrets(
	context: IHookFunctions | IWebhookFunctions,
	credentialType: string,
): Promise<string[]> {
	const webhookSecret = await getWebhookSecret(context, credentialType);
	const credentials = await context.getCredentials(credentialType);
	const previousWebhookSecret = credentials.previousWebhookSecret;
	if (
		typeof previousWebhookSecret === 'string' &&
		previousWebhookSecret !== '' &&
		previousWebhookSecret !== webhookSecret
	) {
		return [webhookSecret, previousWebhookSecret];
	}
	return [webhookSecret];
}
