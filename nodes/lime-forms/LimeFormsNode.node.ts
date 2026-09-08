import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodePropertyTypes,
} from 'n8n-workflow';
import { FORMS_API_CREDENTIALS_NAME } from '../../credentials';
import { RECEIPT_RESOURCE } from './models';
import { ReceiptType } from './types/enums/ReceiptType';
import { getReceipt } from './transport/receipts';

export class LimeFormsNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Lime CRM Forms',
		name: 'limeCrmForms',
		documentationUrl:
			'https://platform.docs.lime-crm.com/en/latest/workflows-and-integrations/node-reference/',
		icon: 'file:assets/lime-forms.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Lime CRM Forms',
		defaults: {
			name: 'Lime CRM Forms',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: FORMS_API_CREDENTIALS_NAME,
				required: true,
			},
		],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options' as NodePropertyTypes,
				noDataExpression: true,
				options: [
					{
						name: 'Receipt',
						value: RECEIPT_RESOURCE,
						description: 'Work with submission receipts',
					},
				],
				default: RECEIPT_RESOURCE,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options' as NodePropertyTypes,
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: [RECEIPT_RESOURCE],
					},
				},
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get a receipt PDF for a submission',
						action: 'Get a receipt',
					},
				],
				default: 'get',
			},
			{
				displayName: 'Submission Slug',
				name: 'submissionSlug',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: [RECEIPT_RESOURCE],
						operation: ['get'],
					},
				},
				default: '',
				description: 'The slug of the submission to get the receipt for',
			},
			{
				displayName: 'Receipt Type',
				name: 'receiptType',
				type: 'options' as NodePropertyTypes,
				required: true,
				displayOptions: {
					show: {
						resource: [RECEIPT_RESOURCE],
						operation: ['get'],
					},
				},
				options: [
					{
						name: 'Submission',
						value: ReceiptType.SUBMISSION,
						description: 'Receipt showing the submitted form data',
					},
					{
						name: 'Signing',
						value: ReceiptType.SIGNING,
						description: 'Signing receipt',
					},
				],
				default: ReceiptType.SUBMISSION,
				description: 'The type of receipt to retrieve',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				if (resource === RECEIPT_RESOURCE && operation === 'get') {
					const submissionSlug = this.getNodeParameter('submissionSlug', i) as string;
					const receiptType = this.getNodeParameter('receiptType', i) as ReceiptType;

					const response = await getReceipt(this, submissionSlug, receiptType);

					if (response.success) {
						returnData.push({
							json: {},
							binary: {
								data: response.data,
							},
							pairedItem: { item: i },
						});
					} else {
						returnData.push({
							json: response.data,
							pairedItem: { item: i },
						});
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error.message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
