import { LimeFormsRequest } from '../../../nodes/lime-forms/transport/request';

describe('LimeFormsRequest', () => {
	const mockLoader = {
		getCredentials: jest.fn().mockResolvedValue({ url: 'https://api.example.com' }),
		getNode: jest.fn().mockReturnValue({
			id: 1,
			name: 'LimeFormsNode',
			type: 'limeFormsTrigger',
		}),
		getWorkflow: jest.fn().mockReturnValue({ id: 'wf', name: 'Workflow' }),
		getInstanceId: jest.fn().mockReturnValue('instance-id'),
		getExecutionId: jest.fn().mockReturnValue('exec-id'),
		getMode: jest.fn().mockReturnValue('manual'),
		helpers: {
			httpRequestWithAuthentication: jest.fn().mockResolvedValue({ success: true, data: {} }),
		},
	};

	it('runs request with authentication', async () => {
		const req = new LimeFormsRequest(mockLoader as any);
		const result = await req.get('/test');
		expect(mockLoader.getCredentials).toHaveBeenCalled();
		expect(mockLoader.helpers.httpRequestWithAuthentication).toHaveBeenCalled();
		expect(result).toEqual({ success: true, data: {} });
	});

	it('throws error if no credentials', async () => {
		const loaderNoCreds = {
			...mockLoader,
			getCredentials: jest.fn().mockResolvedValue(undefined),
		};
		const req = new LimeFormsRequest(loaderNoCreds as any);
		await expect(req.get('/test')).rejects.toThrow('No credentials provided');
	});
});
