import { LoggerProxy as Logger, NodeApiError } from 'n8n-workflow';
import { ApiErrorResponse } from '../types/resources/ApiErrorResponse';
import { ObservableWebhookSimpleResource } from '../types/resources/ObservableWebhookResources';

const HTTP_STATUS_CONFLICT = 409;

/**
 * Pull the conflicting webhook out of a 409 from Lime Forms. Its `store()`
 * endpoint answers a duplicate through the shared `ApiResponse::error()`
 * helper, so the existing webhook is an `ObservableWebhookSimpleResource` at
 * `error.data` in the response body - one level below the envelope. n8n
 * exposes that raw body as `context.data` on the {@link NodeApiError} wrapping
 * the failure, and only sets it when the response carried a parsed object,
 * hence the optional chaining.
 *
 * @param error - the error n8n raised for the failed request
 * @returns the conflicting webhook, or `undefined` when this is not a conflict
 * or the error carries no response body.
 *
 * @see https://github.com/Lundalogik/lime-forms/blob/2.x/app/Helpers/ApiResponse.php
 * @see https://github.com/Lundalogik/lime-forms/blob/2.x/app/Http/Controllers/N8N/ObservableWebhookController.php
 */
export function getConflictingWebhook(
	error: NodeApiError,
): ObservableWebhookSimpleResource | undefined {
	// n8n types `httpCode` as a string, but normalise so a numeric status
	// matches too.
	if (Number(error?.httpCode) !== HTTP_STATUS_CONFLICT) {
		return undefined;
	}

	const body = error.context?.data as ApiErrorResponse<ObservableWebhookSimpleResource>;

	const responseData = body?.error?.data;
	if (responseData === undefined) {
		Logger.warn(
			'Tried to parse response data from Lime Forms duplicate check, but was unable to verify',
		);
	}

	return responseData;
}
