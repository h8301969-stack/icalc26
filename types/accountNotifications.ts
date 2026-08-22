export type NotificationStyle = 'modal' | 'pill';

export type AccountNotificationKind =
  | 'item_added'
  | 'item_restocked'
  | 'price_updated'
  | 'stock_updated'
  | 'image_updated';

export interface AccountNotification {
  id: string;
  accountId: string;
  kind: AccountNotificationKind;
  title: string;
  body: string;
  createdAt: number;
  actorProfileId: string;
  targetProfileId: string;
  readAt?: number;
}

export interface EmitAccountNotificationInput {
  kind: AccountNotificationKind;
  title: string;
  body: string;
  actorProfileId: string;
}
