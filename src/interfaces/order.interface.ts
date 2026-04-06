import { ORDERSIDES } from '../core/constants';

export interface TradeOrder {
    orderSide: ORDERSIDES;
    price: number;
    quantity: number;
    marketSymbol: string;
}

export interface TrackedOrder extends TradeOrder {
    orderId?: string;    // on-chain order_id from the DEX
    placedAt?: string;   // ISO timestamp for debugging
}

export interface MockTrackedOrder extends TrackedOrder {
    mockId: string;
    mockStatus: 'open' | 'filled' | 'cancelled';
    filledAt?: string;
    filledPrice?: number;
}