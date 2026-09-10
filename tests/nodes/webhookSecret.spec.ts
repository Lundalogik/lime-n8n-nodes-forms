import { getWebhookSecret } from '../../nodes/webhookSecret';

describe('getWebhookSecret', () => {
	const node = { id: '1', name: 'Trigger', type: 'limeCrmTrigger' };

	const buildContext = (credentials: Record<string, unknown>) =>
		({
			getNode: jest.fn().mockReturnValue(node),
			getCredentials: jest.fn().mockResolvedValue(credentials),
		}) as never;

	it('returns the secret from the credential', async () => {
		const secret = 'a'.repeat(64);
		await expect(
			getWebhookSecret(buildContext({ webhookSecret: secret }), 'limeCrmApi'),
		).resolves.toBe(secret);
	});

	it.each([[{}], [{ webhookSecret: '' }]])(
		'fails when the credential has no webhook secret (%o)',
		async (credentials) => {
			await expect(getWebhookSecret(buildContext(credentials), 'limeCrmApi')).rejects.toThrow(
				'The credential has no Webhook Secret. Add one to the ' +
					'credential and re-activate the workflow.',
			);
		},
	);
});
