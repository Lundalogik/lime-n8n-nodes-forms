import { IExecuteFunctions } from 'n8n-workflow';
import { getReceipt } from '../../../nodes/lime-forms/transport/receipts';
import { ReceiptType } from '../../../nodes/lime-forms/types/enums/ReceiptType';

const mockHttpRequestWithAuthentication = { call: jest.fn() };
const mockPrepareBinaryData = jest.fn();

function makeContext(overrides?: { onError?: string }): IExecuteFunctions {
    return {
        getNode: jest.fn(() => ({
            name: 'Test',
            id: 't',
            onError: overrides?.onError ?? 'stopWorkflow',
        })),
        getCredentials: jest
            .fn()
            .mockResolvedValue({ url: 'https://forms.example.com' }),
        getWorkflow: jest.fn(() => ({ id: 'wf1', name: 'Test Workflow' })),
        getInstanceId: jest.fn(() => 'instance-1'),
        getExecutionId: jest.fn(() => 'exec-1'),
        getMode: jest.fn(() => 'manual'),
        helpers: {
            httpRequestWithAuthentication: mockHttpRequestWithAuthentication,
            prepareBinaryData: mockPrepareBinaryData,
        },
    } as unknown as IExecuteFunctions;
}

beforeEach(() => {
    mockHttpRequestWithAuthentication.call.mockReset();
    mockPrepareBinaryData.mockReset();
});

describe('getReceipt', () => {
    it('fetches a submission receipt PDF successfully', async () => {
        const pdfBuffer = Buffer.from('fake-pdf-content');
        mockHttpRequestWithAuthentication.call.mockResolvedValue({
            body: pdfBuffer,
        });
        mockPrepareBinaryData.mockResolvedValue({
            data: pdfBuffer.toString('base64'),
            mimeType: 'application/octet-stream',
        });

        const ctx = makeContext();
        const result = await getReceipt(
            ctx,
            'submission-slug-123',
            ReceiptType.SUBMISSION
        );

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.mimeType).toBe('application/pdf');
            expect(result.data.fileName).toBe('submission-receipt.pdf');
            expect(result.data.fileExtension).toBe('pdf');
        }

        expect(mockHttpRequestWithAuthentication.call).toHaveBeenCalledWith(
            ctx,
            'limeFormsApi',
            expect.objectContaining({
                method: 'GET',
                url: 'https://forms.example.com/api/v1/receipts/submission-slug-123/SUBMISSION',
                encoding: 'arraybuffer',
            })
        );
    });

    it('returns an error envelope when the API call fails on Forms 3.x', async () => {
        mockHttpRequestWithAuthentication.call.mockRejectedValue({
            message: 'Receipt not available',
            httpCode: 404,
            response: {
                headers: { 'x-limeformsversion': '3.45.0' },
            },
        });

        const ctx = makeContext({ onError: 'continueRegularOutput' });
        const result = await getReceipt(
            ctx,
            'nonexistent-slug',
            ReceiptType.SUBMISSION
        );

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.data.error.message).toContain(
                'Receipt not available'
            );
        }
    });

    it('returns version requirement message when endpoint not found on Forms 2.x', async () => {
        mockHttpRequestWithAuthentication.call.mockRejectedValue({
            message: 'Not found',
            httpCode: 404,
            // No x-limeformsversion header - indicates Forms 2.x
        });

        const ctx = makeContext({ onError: 'continueRegularOutput' });
        const result = await getReceipt(
            ctx,
            'some-slug',
            ReceiptType.SUBMISSION
        );

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.data.error.message).toContain(
                'This feature requires Lime CRM Forms 3.x or later'
            );
        }
    });
});
