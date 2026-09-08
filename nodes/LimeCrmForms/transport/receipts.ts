import { IExecuteFunctions, IBinaryData } from 'n8n-workflow';
import { FORMS_API_CREDENTIALS_NAME } from '../../../credentials';
import { buildLimeHeaders } from '../../limeHeaders';
import { ReceiptType } from '../types/enums/ReceiptType';
import { APIResponse } from '../../response';
import { handleWorkflowError } from '../../errorHandling';

/**
 * Retrieve a receipt PDF for a form submission.
 *
 * @param nodeContext - n8n execution context
 * @param submissionSlug - The slug identifying the submission
 * @param receiptType - The type of receipt to retrieve (SUBMISSION or SIGNING)
 * @returns Binary data containing the PDF receipt
 *
 * @public
 * @group Transport
 */
export async function getReceipt(
	nodeContext: IExecuteFunctions,
	submissionSlug: string,
	receiptType: ReceiptType,
): Promise<APIResponse<IBinaryData>> {
	const credentials = await nodeContext.getCredentials(FORMS_API_CREDENTIALS_NAME);
	const baseUrl = credentials.url as string;
	const url = `${baseUrl}/api/v1/receipts/${submissionSlug}/${receiptType}`;

	try {
		const response = await nodeContext.helpers.httpRequestWithAuthentication.call(
			nodeContext,
			FORMS_API_CREDENTIALS_NAME,
			{
				method: 'GET',
				url,
				encoding: 'arraybuffer',
				returnFullResponse: true,
				headers: {
					...buildLimeHeaders(nodeContext),
					Accept: 'application/pdf',
				},
			},
		);

		const binaryData = await nodeContext.helpers.prepareBinaryData(
			Buffer.from(response.body as Buffer),
		);
		binaryData.mimeType = 'application/pdf';
		binaryData.fileExtension = 'pdf';
		binaryData.fileName = `${receiptType.toLowerCase()}-receipt.pdf`;

		return {
			success: true,
			data: binaryData,
		};
	} catch (error) {
		const httpCode = error.httpCode ?? error.statusCode;
		const errorMessage = error.message ?? '';

		// Header names are lowercase in Node.js
		const responseHeaders = error.response?.headers ?? error.headers ?? {};
		const version = responseHeaders['x-limeformsversion'] as string | undefined;
		const majorVersion = version ? Number.parseInt(version[0], 10) : 0;

		// TODO: Remove the check after everyone is running Forms 3.x
		if (httpCode === 404 && majorVersion < 3) {
			return handleWorkflowError(
				nodeContext.getNode(),
				{
					message: 'Receipt endpoint not found. This feature requires Lime CRM Forms 3.x or later.',
					status: httpCode,
				},
				true,
			);
		}

		return handleWorkflowError(
			nodeContext.getNode(),
			{
				message: errorMessage || 'Failed to fetch receipt',
				status: httpCode,
			},
			true,
		);
	}
}
