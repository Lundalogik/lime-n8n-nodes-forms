import { createHash, createHmac, randomUUID } from 'node:crypto';
import { LimeCrmFormsTrigger } from '../../../nodes/LimeCrmForms/LimeCrmFormsTrigger.node';

describe('LimeCrmFormsTrigger webhook secret handling', () => {
	const node = {
		id: '1',
		name: 'Lime Forms',
		type: 'limeCrmFormsTrigger',
	};

	const credentialSecret = 'a'.repeat(64);

	const buildLoader = (overrides: Record<string, unknown> = {}) => ({
		getNode: jest.fn().mockReturnValue(node),
		getWorkflow: jest.fn().mockReturnValue({ id: 'wf', name: 'Workflow' }),
		getInstanceId: jest.fn().mockReturnValue('instance-id'),
		getInstanceBaseUrl: jest.fn().mockReturnValue('https://n8n.example.com/'),
		getExecutionId: jest.fn().mockReturnValue('exec-id'),
		getMode: jest.fn().mockReturnValue('manual'),
		getCredentials: jest.fn().mockResolvedValue({
			url: 'https://api.example.com',
			webhookSecret: credentialSecret,
		}),
		helpers: {
			returnJsonArray: jest.fn((data: unknown) => data),
		},
		...overrides,
	});

	describe('create', () => {
		const conflictingWebhook = {
			id: 42,
			name: 'N8N: my-webhook',
			observableType: 'FORM',
			observableId: 'form-1',
			action: 'FORM_SUBMITTED',
			webhookUrl: 'https://n8n.example.com/webhook',
		};

		/**
		 * A 409 as n8n surfaces it: the raw response body from
		 * `ApiResponse::error()` hangs off `context.data`. n8n derives
		 * `httpCode` from `response.status.toString()`, so a string is what
		 * production sees - a number is accepted all the same.
		 * @param httpCode - status as n8n reported it
		 */
		const buildConflict = (httpCode: string | number = '409'): Record<string, unknown> => ({
			httpCode,
			message: 'Conflict',
			context: {
				data: {
					success: false,
					error: {
						code: 'Conflict',
						message: 'An observable webhook with the same parameters already exists.',
						data: conflictingWebhook,
					},
				},
			},
		});

		const buildCreateLoader = (
			httpRequestWithAuthentication: jest.Mock,
			staticData: Record<string, unknown> = {},
		) =>
			buildLoader({
				getNodeParameter: jest
					.fn()
					.mockImplementation((name: string) => (name === 'name' ? 'my-webhook' : 'form-1')),
				getNodeWebhookUrl: jest.fn().mockReturnValue('https://n8n.example.com/webhook'),
				getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
				helpers: { httpRequestWithAuthentication },
			});

		it('sends the credential secret to Lime Forms without persisting it in static data', async () => {
			const staticData: Record<string, unknown> = {};
			const httpRequestWithAuthentication = jest
				.fn()
				.mockResolvedValue({ success: true, data: { id: 'wh-123' } });

			const loader = buildLoader({
				getNodeParameter: jest
					.fn()
					.mockImplementation((name: string) => (name === 'name' ? 'my-webhook' : 'form-1')),
				getNodeWebhookUrl: jest.fn().mockReturnValue('https://n8n.example.com/webhook'),
				getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
				helpers: { httpRequestWithAuthentication },
			});

			const trigger = new LimeCrmFormsTrigger();
			const result = await trigger.webhookMethods.default.create.call(loader as never);

			expect(result).toBe(true);
			expect(staticData.id).toBe('wh-123');

			const sentBody = httpRequestWithAuthentication.mock.calls[0][1].body as {
				secret: string;
				workflowUrl: string;
			};
			// The workflow link is built from the instance base URL.
			expect(sentBody.workflowUrl).toBe('https://n8n.example.com/workflow/wf');
			// The secret handed to Lime Forms is the one from the credential
			// and no copy of it ends up in the workflow static data.
			expect(sentBody.secret).toBe(credentialSecret);
			expect(staticData.webhookSecret).toBeUndefined();
		});

		it('registers through the v2 API and remembers the signature version', async () => {
			const staticData: Record<string, unknown> = {};
			const httpRequestWithAuthentication = jest
				.fn()
				.mockResolvedValue({ success: true, data: { id: 'wh-123' } });

			const trigger = new LimeCrmFormsTrigger();
			await trigger.webhookMethods.default.create.call(
				buildCreateLoader(httpRequestWithAuthentication, staticData) as never,
			);

			expect(httpRequestWithAuthentication.mock.calls[0][1].url).toBe(
				'/api/v2/observable-webhooks',
			);
			expect(staticData.signatureVersion).toBe('v2');
		});

		it('falls back to the v1 API against a Lime Forms without v2', async () => {
			const staticData: Record<string, unknown> = {};
			const httpRequestWithAuthentication = jest
				.fn()
				.mockImplementation((_credentials: string, options: { url: string }) => {
					if (options.url === '/api/v2/observable-webhooks') {
						throw Object.assign(new Error('Not Found'), { httpCode: '404' });
					}
					return { success: true, data: { id: 'wh-123' } };
				});

			const trigger = new LimeCrmFormsTrigger();
			const result = await trigger.webhookMethods.default.create.call(
				buildCreateLoader(httpRequestWithAuthentication, staticData) as never,
			);

			expect(result).toBe(true);
			expect(staticData.id).toBe('wh-123');
			expect(staticData.signatureVersion).toBe('v1');
			expect(httpRequestWithAuthentication.mock.calls.map((call) => call[1].url)).toEqual([
				'/api/v2/observable-webhooks',
				'/api/v1/observable-webhooks',
			]);
		});

		it('recreates a duplicate webhook through the v2 API', async () => {
			const staticData: Record<string, unknown> = {};
			const httpRequestWithAuthentication = jest
				.fn()
				.mockRejectedValueOnce(buildConflict())
				.mockResolvedValueOnce({ success: true, data: null })
				.mockResolvedValueOnce({ success: true, data: { id: 'wh-123' } });

			const trigger = new LimeCrmFormsTrigger();
			const result = await trigger.webhookMethods.default.create.call(
				buildCreateLoader(httpRequestWithAuthentication, staticData) as never,
			);

			expect(result).toBe(true);
			expect(staticData.signatureVersion).toBe('v2');
			expect(
				httpRequestWithAuthentication.mock.calls.map((call) => [call[1].method, call[1].url]),
			).toEqual([
				['POST', '/api/v2/observable-webhooks'],
				['DELETE', '/api/v1/observable-webhooks/42'],
				['POST', '/api/v2/observable-webhooks'],
			]);
		});

		it('fails when the credential has no webhook secret', async () => {
			const loader = buildLoader({
				getCredentials: jest.fn().mockResolvedValue({ url: 'https://api.example.com' }),
				getNodeParameter: jest
					.fn()
					.mockImplementation((name: string) => (name === 'name' ? 'my-webhook' : 'form-1')),
				getNodeWebhookUrl: jest.fn().mockReturnValue('https://n8n.example.com/webhook'),
				getWorkflowStaticData: jest.fn().mockReturnValue({}),
			});

			const trigger = new LimeCrmFormsTrigger();
			await expect(trigger.webhookMethods.default.create.call(loader as never)).rejects.toThrow(
				'The credential has no Webhook Secret. Add one to the ' +
					'credential and re-activate the workflow.',
			);
		});

		describe('when Lime Forms reports a duplicate', () => {
			it.each([['409'], [409]])(
				'deletes the conflicting webhook by its id and registers a new one (httpCode %p)',
				async (httpCode: string | number) => {
					const staticData: Record<string, unknown> = {};
					const httpRequestWithAuthentication = jest
						.fn()
						.mockRejectedValueOnce(buildConflict(httpCode))
						.mockResolvedValueOnce({ success: true, data: null })
						.mockResolvedValueOnce({
							success: true,
							data: { id: 'wh-456' },
						});

					const trigger = new LimeCrmFormsTrigger();
					const result = await trigger.webhookMethods.default.create.call(
						buildCreateLoader(httpRequestWithAuthentication, staticData) as never,
					);

					expect(result).toBe(true);
					expect(staticData.id).toBe('wh-456');

					const [, deleteOptions] = httpRequestWithAuthentication.mock.calls[1];
					expect(deleteOptions).toMatchObject({
						method: 'DELETE',
						url: '/api/v1/observable-webhooks/42',
					});

					// The retry goes through the newest API again
					const [, retryOptions] = httpRequestWithAuthentication.mock.calls[2];
					expect(retryOptions).toMatchObject({
						method: 'POST',
						url: '/api/v2/observable-webhooks',
					});
					// The retry sends the credential secret and leaves no
					// copy of it in the workflow static data.
					expect((retryOptions.body as { secret: string }).secret).toBe(credentialSecret);
					expect(staticData.webhookSecret).toBeUndefined();
				},
			);

			// n8n only fills `context.data` when the response carried a
			// parsed body, so without one there is no id to delete by.
			it('does not attempt a recovery when the error carries no response body', async () => {
				const httpRequestWithAuthentication = jest.fn().mockRejectedValueOnce({
					httpCode: '409',
					message: 'Conflict',
					context: {},
				});

				const trigger = new LimeCrmFormsTrigger();

				await expect(
					trigger.webhookMethods.default.create.call(
						buildCreateLoader(httpRequestWithAuthentication) as never,
					),
				).rejects.toThrow();

				expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
			});

			it('does not register again when deleting the conflicting webhook fails', async () => {
				const httpRequestWithAuthentication = jest
					.fn()
					.mockRejectedValueOnce(buildConflict())
					.mockResolvedValueOnce({ success: false, data: null });

				const trigger = new LimeCrmFormsTrigger();

				await expect(
					trigger.webhookMethods.default.create.call(
						buildCreateLoader(httpRequestWithAuthentication) as never,
					),
				).rejects.toThrow('Failed to delete the existing webhook in Lime Forms');

				expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
			});

			it('propagates failures that are not a conflict', async () => {
				const httpRequestWithAuthentication = jest.fn().mockRejectedValueOnce({
					httpCode: '500',
					message: 'Internal Server Error',
				});

				const trigger = new LimeCrmFormsTrigger();

				await expect(
					trigger.webhookMethods.default.create.call(
						buildCreateLoader(httpRequestWithAuthentication) as never,
					),
				).rejects.toThrow();

				expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
			});
		});
	});

	describe('checkExists', () => {
		it('re-registers webhooks that still have a legacy secret in static data', async () => {
			const staticData: Record<string, unknown> = {
				id: 'wh-123',
				webhookSecret: 'legacy-encrypted-blob',
			};
			const httpRequestWithAuthentication = jest.fn();

			const loader = buildLoader({
				getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
				helpers: { httpRequestWithAuthentication },
			});

			const trigger = new LimeCrmFormsTrigger();
			const result = await trigger.webhookMethods.default.checkExists.call(loader as never);

			// Reported as missing so `create` re-registers the webhook with
			// the secret from the credential.
			expect(result).toBe(false);
			expect(staticData.webhookSecret).toBeUndefined();
			expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
		});
	});

	describe.each([
		['v2', '/api/v2/observable-webhooks/wh-123'],
		['v1', '/api/v1/observable-webhooks/wh-123'],
	])('with a %s webhook', (signatureVersion, expectedUrl) => {
		it('checks that it exists through its own API version', async () => {
			const staticData: Record<string, unknown> = { id: 'wh-123', signatureVersion };
			const httpRequestWithAuthentication = jest
				.fn()
				.mockResolvedValue({ success: true, data: { id: 'wh-123' } });
			const loader = buildLoader({
				getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
				helpers: { httpRequestWithAuthentication },
			});

			const trigger = new LimeCrmFormsTrigger();
			const result = await trigger.webhookMethods.default.checkExists.call(loader as never);

			expect(result).toBe(true);
			expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
				method: 'GET',
				url: expectedUrl,
			});
		});

		it('deletes it through its own API version and forgets it', async () => {
			const staticData: Record<string, unknown> = { id: 'wh-123', signatureVersion };
			const httpRequestWithAuthentication = jest
				.fn()
				.mockResolvedValue({ success: true, data: null });
			const loader = buildLoader({
				getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
				helpers: { httpRequestWithAuthentication },
			});

			const trigger = new LimeCrmFormsTrigger();
			const result = await trigger.webhookMethods.default.delete.call(loader as never);

			expect(result).toBe(true);
			expect(staticData).toEqual({});
			expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
				method: 'DELETE',
				url: expectedUrl,
			});
		});
	});

	describe('webhook', () => {
		const buildSignedRequest = (secret: string) => {
			const staticData = { id: 'wh-123' };
			const body = { data: { formId: 'form-1', value: 'hello' } };
			const rawBody = Buffer.from(JSON.stringify(body));
			const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
			return { staticData, body, rawBody, signature };
		};

		const buildRequestObject = (rawBody: Buffer) => jest.fn().mockReturnValue({ rawBody });

		it('validates the signature using the credential secret', async () => {
			const { staticData, body, rawBody, signature } = buildSignedRequest(credentialSecret);

			const loader = buildLoader({
				getBodyData: jest.fn().mockReturnValue(body),
				getRequestObject: buildRequestObject(rawBody),
				getHeaderData: jest.fn().mockReturnValue({ 'x-signature': signature }),
				getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
			});

			const trigger = new LimeCrmFormsTrigger();
			const response = await trigger.webhook.call(loader as never);

			expect(response.workflowData).toEqual([[body.data]]);
		});

		it('verifies the bytes on the wire, not a re-serialised body', async () => {
			const staticData = { id: 'wh-123' };
			const body = { data: { formId: 'form-1', value: 'hello' } };
			// Same JSON, different bytes than JSON.stringify(body) would give
			const rawBody = Buffer.from(JSON.stringify(body, null, 2));
			const signature = createHmac('sha256', credentialSecret).update(rawBody).digest('hex');

			const loader = buildLoader({
				getBodyData: jest.fn().mockReturnValue(body),
				getRequestObject: buildRequestObject(rawBody),
				getHeaderData: jest.fn().mockReturnValue({ 'x-signature': signature }),
				getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
			});

			const trigger = new LimeCrmFormsTrigger();
			const response = await trigger.webhook.call(loader as never);

			expect(response.workflowData).toEqual([[body.data]]);
		});

		it('returns an error when the signature does not match the credential secret', async () => {
			const { staticData, body, rawBody } = buildSignedRequest('b'.repeat(64));

			const loader = buildLoader({
				// Keep the error on the regular output instead of throwing.
				getNode: jest.fn().mockReturnValue({
					...node,
					onError: 'continueRegularOutput',
				}),
				getBodyData: jest.fn().mockReturnValue(body),
				getRequestObject: buildRequestObject(rawBody),
				getHeaderData: jest.fn().mockReturnValue({ 'x-signature': 'deadbeef' }),
				getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
			});

			const trigger = new LimeCrmFormsTrigger();
			const response = await trigger.webhook.call(loader as never);

			expect(response.workflowData![0]).toEqual([
				{
					success: false,
					data: {
						error: { message: 'Webhook authentication failed, signatures do not match' },
					},
				},
			]);
		});

		it('returns an error when the credential has no webhook secret', async () => {
			const { staticData, body, rawBody, signature } = buildSignedRequest(credentialSecret);

			const loader = buildLoader({
				getNode: jest.fn().mockReturnValue({
					...node,
					onError: 'continueRegularOutput',
				}),
				getCredentials: jest.fn().mockResolvedValue({ url: 'https://api.example.com' }),
				getBodyData: jest.fn().mockReturnValue(body),
				getRequestObject: buildRequestObject(rawBody),
				getHeaderData: jest.fn().mockReturnValue({ 'x-signature': signature }),

				getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
			});

			const trigger = new LimeCrmFormsTrigger();
			const response = await trigger.webhook.call(loader as never);

			expect(response.workflowData![0]).toEqual([
				{
					success: false,
					data: {
						error: {
							message:
								'The credential has no Webhook Secret. Add ' +
								'one to the credential and re-activate the ' +
								'workflow.',
						},
					},
				},
			]);
		});
	});

	describe('webhook with a version 2 webhook', () => {
		const body = { data: { formId: 'form-1', value: 'hello' } };
		const rawBody = Buffer.from(JSON.stringify(body));

		const signV2 = (secret: string, deliveryId: string, timestamp: number, data: Buffer) => {
			const bodyHash = createHash('sha256').update(data).digest('hex');
			return (
				'v2=' +
				createHmac('sha256', secret)
					.update(`v2:${deliveryId}:${timestamp}:${bodyHash}`)
					.digest('hex')
			);
		};

		const buildV2Request = (
			secret: string,
			{ timestamp = Math.floor(Date.now() / 1000), deliveryId = randomUUID() } = {},
		) => ({
			'x-lime-signature': signV2(secret, deliveryId, timestamp, rawBody),
			'x-lime-delivery-id': deliveryId,
			'x-lime-delivery-timestamp': String(timestamp),
		});

		const buildV2Loader = (headers: Record<string, string>, overrides = {}) =>
			buildLoader({
				getNode: jest.fn().mockReturnValue({ ...node, onError: 'continueRegularOutput' }),
				getWorkflowStaticData: jest.fn().mockReturnValue({ id: 'wh-123', signatureVersion: 'v2' }),
				getRequestObject: jest.fn().mockReturnValue({ rawBody }),
				getHeaderData: jest.fn().mockReturnValue(headers),
				getBodyData: jest.fn().mockReturnValue(body),
				...overrides,
			});

		const errorMessageOf = (response: { workflowData?: unknown[][] }) =>
			(response.workflowData![0][0] as { data: { error: { message: string } } }).data.error.message;

		it('triggers the workflow for a valid version 2 delivery', async () => {
			const headers = buildV2Request(credentialSecret);
			const trigger = new LimeCrmFormsTrigger();

			const response = await trigger.webhook.call(buildV2Loader(headers) as never);

			expect(response.workflowData).toEqual([[body.data]]);
		});

		it('does not trigger the workflow twice for the same delivery', async () => {
			const headers = buildV2Request(credentialSecret);
			const trigger = new LimeCrmFormsTrigger();

			await trigger.webhook.call(buildV2Loader(headers) as never);
			const replay = await trigger.webhook.call(buildV2Loader(headers) as never);

			expect(errorMessageOf(replay)).toBe(
				`Webhook authentication failed, delivery ${headers['x-lime-delivery-id']} was already processed`,
			);
		});

		it('rejects a delivery older than five minutes', async () => {
			const headers = buildV2Request(credentialSecret, {
				timestamp: Math.floor(Date.now() / 1000) - 301,
			});
			const trigger = new LimeCrmFormsTrigger();

			const response = await trigger.webhook.call(buildV2Loader(headers) as never);

			expect(errorMessageOf(response)).toBe(
				'Webhook authentication failed, delivery timestamp is outside the 300s freshness window',
			);
		});

		it('rejects a tampered body', async () => {
			const headers = buildV2Request(credentialSecret);
			const tampered = Buffer.from(JSON.stringify({ data: { formId: 'form-2' } }));
			const trigger = new LimeCrmFormsTrigger();

			const response = await trigger.webhook.call(
				buildV2Loader(headers, {
					getRequestObject: jest.fn().mockReturnValue({ rawBody: tampered }),
				}) as never,
			);

			expect(errorMessageOf(response)).toBe(
				'Webhook authentication failed, signatures do not match',
			);
		});

		it('rejects a version 1 signature replayed to a version 2 webhook', async () => {
			const v1Signature = createHmac('sha256', credentialSecret).update(rawBody).digest('hex');
			const trigger = new LimeCrmFormsTrigger();

			const response = await trigger.webhook.call(
				buildV2Loader({ 'x-signature': v1Signature }) as never,
			);

			expect(errorMessageOf(response)).toBe(
				'Webhook authentication failed, expected a v2 signature but received v1',
			);
		});

		it('accepts a delivery signed with the previous secret during a rotation', async () => {
			const previousSecret = 'b'.repeat(64);
			const headers = buildV2Request(previousSecret);
			const trigger = new LimeCrmFormsTrigger();

			const response = await trigger.webhook.call(
				buildV2Loader(headers, {
					getCredentials: jest.fn().mockResolvedValue({
						url: 'https://api.example.com',
						webhookSecret: credentialSecret,
						previousWebhookSecret: previousSecret,
					}),
				}) as never,
			);

			expect(response.workflowData).toEqual([[body.data]]);
		});
	});
});
