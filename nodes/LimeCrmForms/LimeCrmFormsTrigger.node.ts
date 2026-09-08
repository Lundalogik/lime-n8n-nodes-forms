import {
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	NodeConnectionTypes,
	LoggerProxy as Logger,
	NodeOperationError,
	NodeApiError,
	IDataObject,
} from 'n8n-workflow';
import { LimeFormsRequest } from './transport/request';
import { FormExternalIntegrationSimpleResource } from './types/resources/FormExternalIntegrationSimpleResource';
import {
	ObservableWebhookDetailedResource,
	ObservableWebhookSimpleResource,
} from './types/resources/ObservableWebhookResources';
import { ObservableActionType } from './types/enums/ObservableAction';
import { ObservableType } from './types/enums/ObservableType';
import { FORMS_API_CREDENTIALS_NAME } from '../../credentials';
import { getWorkflowUrl } from './utils/workflow';
import { verifyHmac } from '../crypto';
import { getWebhookSecret } from '../webhookSecret';
import { limeFormsApiTest } from '../credentialTests';
import { getConflictingWebhook } from './utils/errors';
import { handleWorkflowError } from '../errorHandling';

const FORMS_OBSERVABLE_WEBHOOK_NAME_PREFIX = 'N8N';

export class LimeCrmFormsTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Lime CRM Forms Trigger',
		name: 'limeCrmFormsTrigger',
		documentationUrl:
			'https://platform.docs.lime-crm.com/en/latest/workflows-and-integrations/node-reference/',
		group: ['trigger'],
		version: 1,
		icon: 'file:assets/lime-forms.svg',
		description: 'Handle webhooks from Lime CRM Forms',
		defaults: {
			name: 'Lime CRM Forms Trigger',
		},
		credentials: [
			{
				name: FORMS_API_CREDENTIALS_NAME,
				required: true,
				testedBy: 'limeFormsApiTest',
			},
		],
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'lime-forms',
			},
		],
		properties: [
			{
				displayName: 'Trigger Name',
				name: 'name',
				type: 'string',
				default: '',
				placeholder: 'my-lime-webhook',
				required: true,
				description: 'Name for this webhook subscription',
			},
			{
				displayName: 'Form to monitor',
				name: 'formId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getForms',
				},
				default: '',
				description:
					'Form to observe submissions for. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	};

	methods = {
		credentialTest: {
			limeFormsApiTest,
		},
		loadOptions: {
			async getForms(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await new LimeFormsRequest<FormExternalIntegrationSimpleResource[]>(
					this,
				).get('/api/v1/external-integrations/forms/');

				if (!response.success) {
					Logger.error(`Lime Forms: Failed to load list of forms`);
					return [];
				}

				return response.data.map((form) => {
					return {
						name: form.name,
						value: form.id,
					};
				});
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');

				// Older versions stored an encrypted copy of the secret in
				// static data. The webhook in Lime Forms still signs with
				// that secret, which is no longer readable, so report the
				// webhook as missing to have `create` re-register it with
				// the secret from the credential (the 409 handling deletes
				// the stale one).
				if (webhookData.webhookSecret) {
					delete webhookData.webhookSecret;
					return false;
				}

				const webhookId = webhookData.id;
				if (webhookId === undefined) {
					return false;
				}
				try {
					const response = await new LimeFormsRequest<ObservableWebhookSimpleResource>(this).get(
						`/api/v1/observable-webhooks/${webhookId}`,
					);
					return response.data !== null;
				} catch (error) {
					if (error?.response && error.response?.status === 404) {
						return false;
					}
					if (error.message) {
						Logger.error(`Lime Forms: ${error.message}`);
					}
					throw new NodeApiError(this.getNode(), {
						message: 'Failed to check if webhook exists in Lime Forms',
					});
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				// The secret comes from the credential, where n8n keeps it
				// encrypted at rest. It is handed to Lime Forms on
				// registration and used to validate the signature of each
				// incoming request.
				const webhookSecret = await getWebhookSecret(this, FORMS_API_CREDENTIALS_NAME);

				const data = {
					name: `${FORMS_OBSERVABLE_WEBHOOK_NAME_PREFIX}: ${this.getNodeParameter('name')}`,
					observableType: ObservableType.FORM,
					observableId: this.getNodeParameter('formId'),
					action: ObservableActionType.FORM_SUBMITTED,
					webhookUrl: this.getNodeWebhookUrl('default'),
					secret: webhookSecret,
					workflowUrl: getWorkflowUrl(
						this.getNode(),
						this.getInstanceBaseUrl(),
						this.getWorkflow().id,
					),
				};

				const registerWebhook = async (): Promise<boolean> => {
					const response = await new LimeFormsRequest<ObservableWebhookDetailedResource>(this).post(
						'/api/v1/observable-webhooks',
						data,
					);

					if (!response.success) {
						throw new NodeApiError(this.getNode(), {
							message: 'Failed to create webhook in Lime Forms',
						});
					}

					webhookData.id = response.data.id;

					return true;
				};

				try {
					return await registerWebhook();
				} catch (error) {
					// 409 indicates a duplicate webhook already exists in Lime
					// Forms, matched on observable type, observable id, action
					// and webhook url - the name is not part of that check. Its
					// secret was set on an earlier registration and may differ
					// from the current one, so reusing it would resurrect
					// the "signatures do not match" failures. Delete the stale
					// webhook and recreate it with the current secret.
					const conflicting = getConflictingWebhook(error);

					if (conflicting === undefined) {
						throw new NodeApiError(this.getNode(), error, {
							message: 'Failed to create webhook in Lime Forms',
						});
					}

					Logger.info(
						`Webhook ${conflicting.name} (id ${conflicting.id}) already exists in Lime Forms, recreating it with a fresh secret`,
						{ errorResponse: error.context?.data },
					);

					const deleted = await new LimeFormsRequest<null>(this).delete(
						`/api/v1/observable-webhooks/${conflicting.id}`,
					);

					if (!deleted.success) {
						throw new NodeApiError(this.getNode(), {
							message: 'Failed to delete the existing webhook in Lime Forms',
						});
					}

					return await registerWebhook();
				}
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				const webhookId = webhookData.id;
				if (webhookId === undefined) {
					return false;
				}

				const response = await new LimeFormsRequest<ObservableWebhookSimpleResource>(this).delete(
					`/api/v1/observable-webhooks/${webhookId}`,
				);

				if (!response.success) {
					throw new NodeApiError(this.getNode(), {
						message: 'Failed to delete webhook in Lime Forms',
					});
				}

				delete webhookData.id;
				delete webhookData.webhookSecret;

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData();
		const headers = this.getHeaderData();
		const returnData: IDataObject[] = [];

		try {
			if (!('x-signature' in headers)) {
				throw new NodeOperationError(
					this.getNode(),
					'No signature header passed. Unable to verify integrity of the data.',
				);
			}

			const webhookSecret = await getWebhookSecret(this, FORMS_API_CREDENTIALS_NAME);
			const isValidSignature = verifyHmac(
				webhookSecret,
				Buffer.from(JSON.stringify(body)),
				('sha256=' + headers['x-signature']) as string,
			);

			if (!isValidSignature) {
				throw new NodeOperationError(this.getNode(), 'Invalid signature');
			}
			returnData.push(body.data as IDataObject);
		} catch (error) {
			const response = handleWorkflowError(this.getNode(), {
				message: error.message,
			});

			returnData.push(response as IDataObject);
		}

		return {
			workflowData: [this.helpers.returnJsonArray(returnData)],
		};
	}
}
