import { createHmac } from 'node:crypto';
import { LimeFormsTrigger } from '../../../nodes/lime-forms/LimeFormsTrigger.node';
import { decryptSecret, encryptSecret } from '../../../nodes/crypto';

describe('LimeFormsTrigger webhook secret handling', () => {
    const node = {
        id: '1',
        name: 'Lime Forms',
        type: 'limeCrmFormsTrigger',
    };

    beforeAll(() => {
        process.env.N8N_ENCRYPTION_KEY = 'test-master-encryption-key';
        process.env.WEBHOOK_URL = 'https://n8n.example.com';
    });

    const buildLoader = (overrides: Record<string, unknown> = {}) => ({
        getNode: jest.fn().mockReturnValue(node),
        getWorkflow: jest.fn().mockReturnValue({ id: 'wf', name: 'Workflow' }),
        getInstanceId: jest.fn().mockReturnValue('instance-id'),
        getExecutionId: jest.fn().mockReturnValue('exec-id'),
        getMode: jest.fn().mockReturnValue('manual'),
        getCredentials: jest
            .fn()
            .mockResolvedValue({ url: 'https://api.example.com' }),
        helpers: {
            returnJsonArray: jest.fn((data: unknown) => data),
        },
        ...overrides,
    });

    describe('create', () => {
        it('stores an encrypted secret in static data and sends the plaintext to Lime Forms', async () => {
            const staticData: Record<string, unknown> = {};
            const httpRequestWithAuthentication = jest
                .fn()
                .mockResolvedValue({ success: true, data: { id: 'wh-123' } });

            const loader = buildLoader({
                getNodeParameter: jest
                    .fn()
                    .mockImplementation((name: string) =>
                        name === 'name' ? 'my-webhook' : 'form-1'
                    ),
                getNodeWebhookUrl: jest
                    .fn()
                    .mockReturnValue('https://n8n.example.com/webhook'),
                getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
                helpers: { httpRequestWithAuthentication },
            });

            const trigger = new LimeFormsTrigger();
            const result = await trigger.webhookMethods.default.create.call(
                loader as never
            );

            expect(result).toBe(true);
            expect(staticData.id).toBe('wh-123');

            const sentBody = httpRequestWithAuthentication.mock.calls[0][1]
                .body as { secret: string };
            // The plaintext secret goes to Lime, never persisted as-is.
            expect(staticData.webhookSecret).toBeDefined();
            expect(staticData.webhookSecret).not.toBe(sentBody.secret);
            // The stored value decrypts back to exactly what Lime received.
            expect(decryptSecret(staticData.webhookSecret as string)).toBe(
                sentBody.secret
            );
        });

        describe('when Lime Forms reports a duplicate', () => {
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
            const buildConflict = (
                httpCode: string | number = '409'
            ): Record<string, unknown> => ({
                httpCode,
                message: 'Conflict',
                context: {
                    data: {
                        success: false,
                        error: {
                            code: 'Conflict',
                            message:
                                'An observable webhook with the same parameters already exists.',
                            data: conflictingWebhook,
                        },
                    },
                },
            });

            const buildCreateLoader = (
                httpRequestWithAuthentication: jest.Mock,
                staticData: Record<string, unknown> = {}
            ) =>
                buildLoader({
                    getNodeParameter: jest
                        .fn()
                        .mockImplementation((name: string) =>
                            name === 'name' ? 'my-webhook' : 'form-1'
                        ),
                    getNodeWebhookUrl: jest
                        .fn()
                        .mockReturnValue('https://n8n.example.com/webhook'),
                    getWorkflowStaticData: jest
                        .fn()
                        .mockReturnValue(staticData),
                    helpers: { httpRequestWithAuthentication },
                });

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

                    const trigger = new LimeFormsTrigger();
                    const result =
                        await trigger.webhookMethods.default.create.call(
                            buildCreateLoader(
                                httpRequestWithAuthentication,
                                staticData
                            ) as never
                        );

                    expect(result).toBe(true);
                    expect(staticData.id).toBe('wh-456');

                    const [, deleteOptions] =
                        httpRequestWithAuthentication.mock.calls[1];
                    expect(deleteOptions).toMatchObject({
                        method: 'DELETE',
                        url: '/api/v1/observable-webhooks/42',
                    });

                    const [, retryOptions] =
                        httpRequestWithAuthentication.mock.calls[2];
                    expect(retryOptions).toMatchObject({
                        method: 'POST',
                        url: '/api/v1/observable-webhooks',
                    });
                    // The retry keeps the secret we already stored encrypted.
                    expect(
                        decryptSecret(staticData.webhookSecret as string)
                    ).toBe((retryOptions.body as { secret: string }).secret);
                }
            );

            // n8n only fills `context.data` when the response carried a
            // parsed body, so without one there is no id to delete by.
            it('does not attempt a recovery when the error carries no response body', async () => {
                const httpRequestWithAuthentication = jest
                    .fn()
                    .mockRejectedValueOnce({
                        httpCode: '409',
                        message: 'Conflict',
                        context: {},
                    });

                const trigger = new LimeFormsTrigger();

                await expect(
                    trigger.webhookMethods.default.create.call(
                        buildCreateLoader(
                            httpRequestWithAuthentication
                        ) as never
                    )
                ).rejects.toThrow();

                expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
            });

            it('does not register again when deleting the conflicting webhook fails', async () => {
                const httpRequestWithAuthentication = jest
                    .fn()
                    .mockRejectedValueOnce(buildConflict())
                    .mockResolvedValueOnce({ success: false, data: null });

                const trigger = new LimeFormsTrigger();

                await expect(
                    trigger.webhookMethods.default.create.call(
                        buildCreateLoader(
                            httpRequestWithAuthentication
                        ) as never
                    )
                ).rejects.toThrow(
                    'Failed to delete the existing webhook in Lime Forms'
                );

                expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
            });

            it('propagates failures that are not a conflict', async () => {
                const httpRequestWithAuthentication = jest
                    .fn()
                    .mockRejectedValueOnce({
                        httpCode: '500',
                        message: 'Internal Server Error',
                    });

                const trigger = new LimeFormsTrigger();

                await expect(
                    trigger.webhookMethods.default.create.call(
                        buildCreateLoader(
                            httpRequestWithAuthentication
                        ) as never
                    )
                ).rejects.toThrow();

                expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe('webhook', () => {
        const buildSignedRequest = (rawSecret: string) => {
            const staticData = {
                id: 'wh-123',
                webhookSecret: encryptSecret(rawSecret),
            };
            const body = { data: { formId: 'form-1', value: 'hello' } };
            const signature = createHmac('sha256', rawSecret)
                .update(JSON.stringify(body))
                .digest('hex');
            return { staticData, body, signature };
        };

        it('validates the signature using the decrypted static-data secret', async () => {
            const rawSecret = 'a'.repeat(64);
            const { staticData, body, signature } =
                buildSignedRequest(rawSecret);

            const loader = buildLoader({
                getBodyData: jest.fn().mockReturnValue(body),
                getHeaderData: jest
                    .fn()
                    .mockReturnValue({ 'x-signature': signature }),
                getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
            });

            const trigger = new LimeFormsTrigger();
            const response = await trigger.webhook.call(loader as never);

            expect(response.workflowData).toEqual([[body.data]]);
        });

        it('returns an error when the signature does not match the stored secret', async () => {
            const rawSecret = 'b'.repeat(64);
            const { staticData, body } = buildSignedRequest(rawSecret);

            const loader = buildLoader({
                // Keep the error on the regular output instead of throwing.
                getNode: jest.fn().mockReturnValue({
                    ...node,
                    onError: 'continueRegularOutput',
                }),
                getBodyData: jest.fn().mockReturnValue(body),
                getHeaderData: jest
                    .fn()
                    .mockReturnValue({ 'x-signature': 'deadbeef' }),
                getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
            });

            const trigger = new LimeFormsTrigger();
            const response = await trigger.webhook.call(loader as never);

            expect(response.workflowData![0]).toEqual([
                {
                    success: false,
                    data: { error: { message: 'Invalid signature' } },
                },
            ]);
        });

        it('returns an error when no secret is stored in static data', async () => {
            const body = { data: { formId: 'form-1' } };
            const signature = createHmac('sha256', 'c'.repeat(64))
                .update(JSON.stringify(body))
                .digest('hex');

            const loader = buildLoader({
                getNode: jest.fn().mockReturnValue({
                    ...node,
                    onError: 'continueRegularOutput',
                }),
                getBodyData: jest.fn().mockReturnValue(body),
                getHeaderData: jest
                    .fn()
                    .mockReturnValue({ 'x-signature': signature }),
                getWorkflowStaticData: jest.fn().mockReturnValue({}),
            });

            const trigger = new LimeFormsTrigger();
            const response = await trigger.webhook.call(loader as never);

            expect(response.workflowData![0]).toEqual([
                {
                    success: false,
                    data: {
                        error: {
                            message:
                                'Webhook is not registered: missing secret in static data',
                        },
                    },
                },
            ]);
        });
    });
});
