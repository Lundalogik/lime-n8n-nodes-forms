import {
	IHookFunctions,
	ILoadOptionsFunctions,
	IHttpRequestMethods,
	NodeApiError,
} from 'n8n-workflow';
import { FORMS_API_CREDENTIALS_NAME } from '../../../credentials';
import { BaseResponse } from '../types/resources/BaseResponse';
import { buildLimeHeaders } from '../../limeHeaders';

export class LimeFormsRequest<T = unknown> {
	constructor(private readonly loader: ILoadOptionsFunctions | IHookFunctions) {}

	public async get(url: string): Promise<BaseResponse<T>> {
		return this.baseRequest('GET', url, undefined);
	}

	public async post(url: string, data: object): Promise<BaseResponse<T>> {
		return this.baseRequest('POST', url, data);
	}

	public async put(url: string, data: object): Promise<BaseResponse<T>> {
		return this.baseRequest('PUT', url, data);
	}

	public async delete(url: string): Promise<BaseResponse<T>> {
		return this.baseRequest('DELETE', url);
	}

	private async baseRequest(
		method: string,
		url: string,
		data: object | undefined = undefined,
	): Promise<BaseResponse<T>> {
		// Get credentials for the API
		const credentials = await this.loader.getCredentials(FORMS_API_CREDENTIALS_NAME);
		if (credentials === undefined) {
			throw new NodeApiError(this.loader.getNode(), {
				message: 'No credentials provided',
			});
		}
		return await this.loader.helpers.httpRequestWithAuthentication.call(
			this.loader,
			FORMS_API_CREDENTIALS_NAME,
			{
				method: method as IHttpRequestMethods,
				url: url,
				json: true,
				body: data,
				baseURL: credentials.url as string,
				headers: {
					...buildLimeHeaders(this.loader),
					Accept: 'application/json',
				},
			},
		);
	}
}
