import { ObservableActionType } from '../enums/ObservableAction';
import { ObservableType } from '../enums/ObservableType';

export type ObservableWebhookSimpleResource = {
    id: number;
    name: string;
    observableType: ObservableType;
    observableId: number;
    action: ObservableActionType;
    webhookUrl: string;
};

export type ObservableWebhookDetailedResource =
    ObservableWebhookSimpleResource & {
        secret: string;
    };
