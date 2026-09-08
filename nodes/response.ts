import { IBinaryData } from 'n8n-workflow';
import { ErrorResponse, WorkflowErrorContext } from './errorHandling';

/**
 * Wrapper for successful response
 */
export type SuccessResponse<T> = {
	success: true;
	data: T;
};

/**
 * Generic wrapper used for describing the data we are returning from workflow
 * execution for the user
 */
export type WorkflowResponse<T> = T | { error: WorkflowErrorContext };

/**
 * Generic wrapper used for describing the data we are getting from the
 * external API layer
 */
export type APIResponse<T> = SuccessResponse<T> | ErrorResponse;

/**
 * Response object that includes both JSON data and optional binary file content.
 * Works in communication layer
 *
 * @typeParam T - The shape of the JSON data returned in the response
 * @property json -  The {@link APIResponse} object, containing structured JSON data.
 * @property binary - An optional record of binary file data
 *
 * @public
 * @group Response
 */
export type FileAPIResponse<T> = {
	json: APIResponse<T>;
	binary?: Record<string, IBinaryData>;
};

/**
 * Response object that includes both JSON data and optional binary file content.
 * Works in user interface layer
 *
 * @typeParam T - The shape of the JSON data returned in the response
 * @property json -  The {@link WorflowResponse} object, containing structured JSON data.
 * @property binary - An optional record of binary file data
 *
 * @public
 * @group Response
 */
export type WorkflowFileResponse<T> = {
	json: WorkflowResponse<T>;
	binary?: Record<string, IBinaryData>;
};
