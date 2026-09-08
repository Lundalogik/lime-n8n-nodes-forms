import {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	IAuthenticate,
	IHttpRequestMethods,
} from 'n8n-workflow';

export const FORMS_API_CREDENTIALS_NAME = 'limeFormsApi';

/**
 * Credentials for Lime Forms
 * --------------------------
 *
 * Allows n8n to connect to Lime Forms API.
 *
 * ## Authentication
 * Uses Bearer Token authentication with an API key/token.
 * Once the credentials are set up, it can be reused across multiple nodes/workflows.
 * N8N will automatically include the API key all requests in Forms nodes.
 *
 * ## Required Fields
 * - **Server URL:** The base URL of your Lime Forms instance.
 *   - Example: `https://instance.lime-forms.com`
 *
 * - **API Key:** The API key generated in Lime Forms.
 *   - You can obtain it from Lime Forms Admin, under settings page.
 *
 * ## Testing Connection
 * The `test` property verifies credentials by pinging an endpoint of the provided Lime Forms instance.
 * If the response is successful (HTTP 200), the credentials are valid.
 *
 * ## Related Documentation
 * - Lime Forms Internal Documentation: https://docs.lime-forms.com/
 * - n8n Credentials Guide: https://docs.n8n.io/integrations/credentials/
 * - Forms authentication layer, Laravel Sanctum: https://laravel.com/docs/12.x/sanctum
 *
 */
export class LimeFormsApi implements ICredentialType {
	name = FORMS_API_CREDENTIALS_NAME;
	displayName = 'Lime CRM Forms API';
	documentationUrl = 'https://docs.lime-forms.com/';
	icon = 'file:assets/lime-crm.svg' as const;
	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'url',
			type: 'string',
			default: '',
			placeholder: 'https://instance.lime-forms.com',
			required: true,
			description: 'The URL of your Lime Forms instance',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'API key obtained from Lime Forms',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.url}}'.replace('/+$', ''),
			url: '/api/v1/external-integrations/ping',
			method: 'GET' as IHttpRequestMethods,
		},
	};

	authenticate: IAuthenticate = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};
}
