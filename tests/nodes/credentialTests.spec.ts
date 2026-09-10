import { limeFormsApiTest } from '../../nodes/credentialTests';

describe.each([['limeFormsApiTest', limeFormsApiTest, '/api/v1/external-integrations/ping']])(
	'%s',
	(_name, credentialTest, pingPath) => {
		const buildContext = (request: jest.Mock) => ({ helpers: { request } }) as never;

		const buildCredential = (data: Record<string, unknown>) =>
			({
				id: '1',
				name: 'test',
				type: 'limeFormsApi',
				data: {
					url: 'https://api.example.com/',
					apiKey: 'api-key',
					...data,
				},
			}) as never;

		it('reports an error when the webhook secret is set but too short', async () => {
			const request = jest.fn();

			const result = await credentialTest.call(
				buildContext(request),
				buildCredential({ webhookSecret: 'short-secret' }),
			);

			expect(result).toEqual({
				status: 'Error',
				message:
					'The Webhook Secret is shorter than the recommended 32 ' +
					'characters. Consider a stronger value, e.g. generated ' +
					'with "openssl rand -hex 32"',
			});
			expect(request).not.toHaveBeenCalled();
		});

		it.each([[{}], [{ webhookSecret: '' }]])(
			'accepts a missing or empty webhook secret (%o)',
			async (data) => {
				const request = jest.fn().mockResolvedValue({});

				const result = await credentialTest.call(buildContext(request), buildCredential(data));

				expect(result).toEqual({
					status: 'OK',
					message: 'Connection successful',
				});
			},
		);

		it('pings the API without a trailing slash in the URL', async () => {
			const request = jest.fn().mockResolvedValue({});

			const result = await credentialTest.call(
				buildContext(request),
				buildCredential({ webhookSecret: 'a'.repeat(64) }),
			);

			expect(result.status).toBe('OK');
			expect(request.mock.calls[0][0].uri).toBe(`https://api.example.com${pingPath}`);
		});

		it('reports an error when the ping fails', async () => {
			const request = jest.fn().mockRejectedValue(new Error('401 - Unauthorized'));

			const result = await credentialTest.call(buildContext(request), buildCredential({}));

			expect(result).toEqual({
				status: 'Error',
				message: 'Connection failed: 401 - Unauthorized',
			});
		});
	},
);
