import { getWebhookSecret, getWebhookSecrets } from '../../nodes/webhookSecret';

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

describe('getWebhookSecrets', () => {
	const node = { id: '1', name: 'Trigger', type: 'limeCrmFormsTrigger' };
	const secret = 'a'.repeat(64);
	const previous = 'b'.repeat(64);

	const buildContext = (credentials: Record<string, unknown>) =>
		({
			getNode: jest.fn().mockReturnValue(node),
			getCredentials: jest.fn().mockResolvedValue(credentials),
		}) as never;

	it('returns the current secret first and the previous one after it', async () => {
		await expect(
			getWebhookSecrets(
				buildContext({ webhookSecret: secret, previousWebhookSecret: previous }),
				'limeFormsApi',
			),
		).resolves.toEqual([secret, previous]);
	});

	it.each([[{}], [{ previousWebhookSecret: '' }], [{ previousWebhookSecret: secret }]])(
		'returns only the current secret when there is no distinct previous one (%o)',
		async (previousField) => {
			await expect(
				getWebhookSecrets(
					buildContext({ webhookSecret: secret, ...previousField }),
					'limeFormsApi',
				),
			).resolves.toEqual([secret]);
		},
	);

	it('fails when the credential has no webhook secret', async () => {
		await expect(
			getWebhookSecrets(buildContext({ previousWebhookSecret: previous }), 'limeFormsApi'),
		).rejects.toThrow('The credential has no Webhook Secret');
	});
});
